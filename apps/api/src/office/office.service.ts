import { createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';
import type { OfficeEditorDto } from '@wiki/shared';
import { AttachmentStorageService } from '../attachments/attachment-storage.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config';
import { Errors } from '../common/errors';
import type { AuthContext } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { matchesFormat, OFFICE_MAGIC_BYTES, officeFormat } from './formats';
import { JwtClaims, signJwt, verifyJwt } from './jwt';

/** Öffentlicher Pfad des Editor-Servers auf der Domain des Wikis (Caddy leitet ihn an den Container weiter) */
export const OFFICE_PATH = '/office';
/** So lange darf der Editor-Server eine Datei mit dem Link aus der Konfiguration abholen */
const FILE_TOKEN_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Status im Rückruf des Editor-Servers (Docs-API) */
const STATUS = { EDITING: 1, READY_FOR_SAVE: 2, SAVE_ERROR: 3, CLOSED: 4, FORCE_SAVE: 6, FORCE_SAVE_ERROR: 7 } as const;

export interface CallbackResult {
  error: 0 | 1;
}

/**
 * Anbindung des Office-Editors (Euro-Office, kompatibel zur ONLYOFFICE Docs-API).
 *
 * Ablauf: Die Weboberfläche holt eine signierte Editor-Konfiguration. Der Editor-Server lädt die Datei
 * über einen kurzlebigen Link im internen Netz, mehrere Personen bearbeiten gemeinsam, und beim Speichern
 * (Speichern-Knopf oder Schließen) ruft der Editor-Server die API mit einem signierten JWT zurück.
 * Die API holt dann die neue Datei beim Editor-Server ab und legt sie als neue Fassung des Anhangs an.
 */
@Injectable()
export class OfficeService {
  private readonly logger = new Logger('Office');
  private readonly secret: string;
  /** Eigener Schlüssel für Datei-Links, unabhängig vom gemeinsamen Geheimnis mit dem Editor-Server */
  private readonly fileSecret: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly storage: AttachmentStorageService,
    private readonly audit: AuditService,
  ) {
    this.secret = config.OFFICE_JWT_SECRET ?? '';
    this.fileSecret = createHmac('sha256', config.SESSION_SECRET).update('office-file').digest('hex');
  }

  private requireEnabled() {
    if (!this.config.OFFICE_ENABLED) throw Errors.notFound();
  }

  /** Signierte Konfiguration für den Editor; Bearbeiten nur mit Bearbeiten-Recht auf der Seite */
  async editorConfig(ctx: AuthContext, id: string, mode: 'edit' | 'view', ip: string): Promise<OfficeEditorDto> {
    this.requireEnabled();
    const { attachment, access } = await this.attachments.load(ctx.user, id, mode);
    const format = officeFormat(attachment.filename);
    if (!format) throw Errors.badRequest('Diese Datei lässt sich nicht im Office-Editor öffnen.', 'NOT_OFFICE');
    if (mode === 'edit' && !format.editable) throw Errors.badRequest('Dieses Format lässt sich nur ansehen.', 'VIEW_ONLY');
    // Der Inhalt muss zum Dateinamen passen, sonst bekäme der Editor eine getarnte Datei
    const head = await this.storage.readHead(attachment.storageKey, OFFICE_MAGIC_BYTES).catch(() => Buffer.alloc(0));
    if (!matchesFormat(format, head)) throw Errors.badRequest('Der Inhalt passt nicht zur Dateiendung.', 'NOT_OFFICE');

    const key = await this.sessionKey(attachment.id, attachment.officeKey);
    const api = this.config.OFFICE_API_URL.replace(/\/$/, '');
    const fileToken = signJwt({ att: attachment.id }, this.fileSecret, FILE_TOKEN_SECONDS);
    const edit = mode === 'edit';
    const config: Record<string, unknown> = {
      documentType: format.documentType,
      document: {
        fileType: format.fileType,
        key,
        title: attachment.filename,
        url: `${api}/api/v1/office/files/${fileToken}`,
        permissions: { edit, comment: edit, review: edit, fillForms: edit, download: true, print: true },
      },
      editorConfig: {
        mode,
        lang: 'de',
        region: 'de-DE',
        callbackUrl: `${api}/api/v1/office/callback`,
        user: { id: ctx.user.id, name: ctx.user.displayName },
        // Speichern-Knopf legt sofort eine Fassung an; Zwischenstände der automatischen Speicherung nicht
        customization: { forcesave: true, autosave: true, uiTheme: 'theme-light' },
      },
    };
    config.token = signJwt(config, this.secret);

    if (edit) {
      await this.audit.log({
        action: 'attachment.office_opened',
        actorId: ctx.user.id,
        targetType: 'attachment',
        targetId: attachment.id,
        ip,
        details: { spaceKey: access.space.key, pageId: attachment.pageId, filename: attachment.filename },
      });
    }
    return {
      scriptUrl: `${OFFICE_PATH}/web-apps/apps/api/documents/api.js`,
      config,
      attachment: this.attachments.toDto(attachment, access.canEdit),
    };
  }

  /** Schlüssel der Bearbeitung: alle, die das Dokument gleichzeitig öffnen, landen in derselben Sitzung */
  private async sessionKey(id: string, current: string | null): Promise<string> {
    if (current) return current;
    const key = randomUUID();
    const { count } = await this.prisma.attachment.updateMany({ where: { id, officeKey: null }, data: { officeKey: key } });
    if (count) return key;
    const row = await this.prisma.attachment.findUniqueOrThrow({ where: { id }, select: { officeKey: true } });
    return row.officeKey ?? this.sessionKey(id, null);
  }

  /** Datei für den Editor-Server; der Link aus der Konfiguration ist die Berechtigung */
  async file(token: string): Promise<StreamableFile> {
    this.requireEnabled();
    const claims = verifyJwt(token, this.fileSecret);
    const id = claims?.att;
    if (typeof id !== 'string' || !UUID.test(id)) throw Errors.notFound();
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw Errors.notFound();
    return this.attachments.stream(attachment, attachment.filename, true);
  }

  /**
   * Rückruf des Editor-Servers. Gilt nur mit gültiger Signatur; ausgewertet werden ausschließlich die
   * signierten Angaben, nicht der restliche Anfrage-Inhalt.
   */
  async callback(body: unknown, authorization: string | undefined): Promise<CallbackResult> {
    this.requireEnabled();
    const claims = this.verifyCallback(body, authorization);
    if (!claims) {
      this.logger.warn('Rückruf ohne gültige Signatur abgelehnt');
      throw Errors.forbidden();
    }
    const status = claims.status;
    const key = claims.key;
    if (typeof key !== 'string' || typeof status !== 'number') throw Errors.badRequest('Ungültiger Rückruf.');

    if (status === STATUS.SAVE_ERROR || status === STATUS.FORCE_SAVE_ERROR) {
      this.logger.error(`Der Editor konnte das Dokument ${key} nicht speichern (Status ${status})`);
      return { error: 0 };
    }
    if (status !== STATUS.READY_FOR_SAVE && status !== STATUS.FORCE_SAVE) return { error: 0 };

    const attachment = await this.prisma.attachment.findUnique({ where: { officeKey: key } });
    if (!attachment) {
      // Fehler melden: der Editor-Server behält die Änderungen dann, statt sie zu verwerfen
      this.logger.error(`Rückruf für unbekannte Bearbeitung ${key}`);
      return { error: 1 };
    }
    const source = typeof claims.url === 'string' ? this.internalUrl(claims.url) : null;
    if (!source) {
      this.logger.error(`Rückruf mit unzulässiger Download-Adresse für Anhang ${attachment.id}`);
      return { error: 1 };
    }

    try {
      const stored = await this.fetchFile(source);
      const userId = await this.editor(claims);
      const version = await this.attachments.addVersion(attachment.id, stored, userId, { endSession: status === STATUS.READY_FOR_SAVE });
      if (version !== null) {
        await this.audit.log({
          action: 'attachment.version_saved',
          actorId: userId,
          targetType: 'attachment',
          targetId: attachment.id,
          details: { pageId: attachment.pageId, filename: attachment.filename, version },
        });
      }
      return { error: 0 };
    } catch (err) {
      this.logger.error(`Speichern von Anhang ${attachment.id} fehlgeschlagen: ${String(err)}`);
      return { error: 1 };
    }
  }

  /**
   * Prüft die Verbindung zum Editor-Server von Ende zu Ende (wikictl office-check): der Editor-Server wandelt
   * eine Textdatei der API in ein DOCX um. Dabei muss er die API im internen Netz erreichen, das gemeinsame
   * JWT-Geheimnis stimmen und die API das Ergebnis beim Editor-Server abholen können.
   */
  async selfCheck(): Promise<string> {
    if (!this.config.OFFICE_ENABLED) throw new Error('Der Office-Editor ist nicht eingeschaltet (WIKI_OFFICE in .env).');
    const request = {
      async: false,
      filetype: 'txt',
      outputtype: 'docx',
      key: randomUUID(),
      title: 'wiki-check.txt',
      url: `${this.config.OFFICE_API_URL.replace(/\/$/, '')}/api/v1/health`,
    };
    const res = await fetch(new URL('/converter', this.config.OFFICE_INTERNAL_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...request, token: signJwt(request, this.secret) }),
      signal: AbortSignal.timeout(120_000),
    }).catch((err: Error) => {
      throw new Error(`Editor-Server unter ${this.config.OFFICE_INTERNAL_URL} nicht erreichbar: ${err.message}`);
    });
    const result = (await res.json().catch(() => ({}))) as { endConvert?: boolean; fileUrl?: string; error?: number };
    if (result.error) {
      const hint = result.error === -8 ? ' (JWT-Geheimnis passt nicht)' : result.error === -4 ? ' (Editor-Server erreicht die API nicht)' : '';
      throw new Error(`Der Editor-Server meldet Fehler ${result.error}${hint}.`);
    }
    if (!res.ok || !result.endConvert || !result.fileUrl) throw new Error(`Unerwartete Antwort des Editor-Servers (HTTP ${res.status}).`);
    const source = this.internalUrl(result.fileUrl);
    if (!source) throw new Error(`Der Editor-Server nennt eine unerwartete Adresse: ${result.fileUrl}`);
    const file = Buffer.from(await (await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(60_000) })).arrayBuffer());
    if (!matchesFormat(officeFormat('x.docx')!, file)) throw new Error('Das Ergebnis der Umwandlung ist kein DOCX.');
    return 'Office-Editor in Ordnung: erreichbar, JWT-Geheimnis stimmt, Datei-Abruf und Rückweg über das interne Netz funktionieren.';
  }

  private verifyCallback(body: unknown, authorization: string | undefined): JwtClaims | null {
    // Token im Inhalt (JWT_IN_BODY) oder im Header Authorization: Bearer (dort unter "payload")
    const inBody = body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined;
    if (typeof inBody === 'string') return verifyJwt(inBody, this.secret);
    const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!bearer) return null;
    const payload = verifyJwt(bearer, this.secret)?.payload;
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as JwtClaims) : null;
  }

  /**
   * Download-Adresse aus dem Rückruf auf den Editor-Server im internen Netz abbilden (Schutz vor SSRF):
   * erlaubt sind nur Adressen unter https://<wiki>/office/ und unter OFFICE_INTERNAL_URL selbst.
   */
  internalUrl(raw: string): string | null {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.username || url.password) return null;
    const internal = new URL(this.config.OFFICE_INTERNAL_URL);
    if (url.origin === internal.origin) return url.toString();
    if (url.origin === new URL(this.config.APP_ORIGIN).origin && url.pathname.startsWith(`${OFFICE_PATH}/`)) {
      return new URL(url.pathname.slice(OFFICE_PATH.length) + url.search, internal).toString();
    }
    return null;
  }

  private async fetchFile(source: string) {
    const res = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) throw new Error(`Editor-Server antwortet mit ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > this.storage.maxBytes) throw Errors.tooLarge(this.config.ATTACHMENT_MAX_MB);
    const stored = await this.storage.store(Readable.fromWeb(res.body as WebReadableStream));
    if (stored.sizeBytes === 0) {
      await this.storage.remove([stored.storageKey]);
      throw new Error('Leere Datei vom Editor-Server');
    }
    return stored;
  }

  /** Wer zuletzt bearbeitet hat (users[0] laut Docs-API); nur bekannte Konten */
  private async editor(claims: JwtClaims): Promise<string | null> {
    const id = Array.isArray(claims.users) ? claims.users[0] : undefined;
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    return user?.id ?? null;
  }
}
