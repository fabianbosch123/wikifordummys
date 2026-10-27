import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import type { AttachmentDto, AttachmentVersionDto } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config';
import { Errors } from '../common/errors';
import type { AuthContext, AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { officeFormat } from '../office/formats';
import { PermissionService } from '../spaces/permission.service';
import { userRef } from '../spaces/spaces.service';
import { AttachmentStorageService, StoredFile } from './attachment-storage.service';
import { cleanFilename, contentDisposition, detectType, previewOf } from './file-type';

const include = { uploadedBy: { select: { id: true, displayName: true } } } as const;

type AttachmentRow = Attachment & { uploadedBy: { id: string; displayName: string } | null };

export interface AttachmentDownload {
  /** null: der Browser hat diesen Stand schon (If-None-Match passt), Antwort 304 ohne Inhalt */
  file: StreamableFile | null;
  etag: string;
}

/** Passt einer der ETags aus If-None-Match (auch schwache W/"…" und *)? */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((tag) => {
    const t = tag.trim();
    return t === '*' || t.replace(/^W\//, '') === etag;
  });
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger('Anhänge');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly storage: AttachmentStorageService,
    private readonly audit: AuditService,
  ) {}

  /** canEdit: der Benutzer darf die Seite bearbeiten (entscheidet über Bearbeiten im Office-Editor) */
  toDto(a: AttachmentRow, canEdit: boolean): AttachmentDto {
    const format = this.config.OFFICE_ENABLED ? officeFormat(a.filename) : null;
    return {
      id: a.id,
      pageId: a.pageId,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      preview: previewOf(a.mimeType),
      uploadedBy: userRef(a.uploadedBy),
      createdAt: a.createdAt.toISOString(),
      version: a.version,
      updatedAt: a.updatedAt.toISOString(),
      url: `/api/v1/attachments/${a.id}`,
      office: format ? (canEdit && format.editable ? 'edit' : 'view') : null,
    };
  }

  async list(user: AuthUser, pageId: string): Promise<AttachmentDto[]> {
    const access = await this.permissions.requirePage(user, pageId, 'view');
    const rows = await this.prisma.attachment.findMany({ where: { pageId }, include, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => this.toDto(a, access.canEdit));
  }

  /** Legt den Anfrage-Inhalt ab; zu groß angekündigt gibt 413 ohne zu lesen, leer gibt 400 */
  private async storeBody(declaredLength: number | null, body: Readable): Promise<StoredFile> {
    if (declaredLength !== null && declaredLength > this.storage.maxBytes) throw Errors.tooLarge(this.config.ATTACHMENT_MAX_MB);
    const stored = await this.storage.store(body);
    if (stored.sizeBytes === 0) {
      await this.storage.remove([stored.storageKey]);
      throw Errors.badRequest('Die Datei ist leer.');
    }
    return stored;
  }

  /**
   * Speichert den Anfrage-Inhalt als Anhang. Die Rechte werden geprüft, bevor auch nur ein Byte gelesen wird.
   * Der angezeigte Typ ergibt sich allein aus dem Inhalt (S7).
   */
  async upload(pageId: string, rawFilename: string, declaredLength: number | null, body: Readable, ctx: AuthContext): Promise<AttachmentDto> {
    await this.permissions.requirePage(ctx.user, pageId, 'edit');
    const stored = await this.storeBody(declaredLength, body);
    const file = { mimeType: detectType(stored.head).mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.storageKey, sha256: stored.sha256 };
    try {
      const created = await this.prisma.attachment.create({
        data: {
          pageId,
          filename: cleanFilename(rawFilename),
          ...file,
          uploadedById: ctx.user.id,
          versions: { create: { version: 1, ...file, createdById: ctx.user.id } },
        },
        include,
      });
      return this.toDto(created, true);
    } catch (err) {
      // Seite inzwischen endgültig gelöscht o. Ä.: keine verwaiste Datei zurücklassen
      await this.storage.remove([stored.storageKey]);
      throw err;
    }
  }

  /**
   * Speichert den Anfrage-Inhalt als neue Fassung eines Anhangs (Rechte wie beim Hochladen).
   * Gleicher Inhalt wie die aktuelle Fassung ergibt keine neue; geliefert wird der Anhang mit seiner aktuellen Fassung.
   */
  async uploadVersion(id: string, declaredLength: number | null, body: Readable, ctx: AuthContext): Promise<AttachmentDto> {
    await this.load(ctx.user, id, 'edit');
    const stored = await this.storeBody(declaredLength, body);
    await this.addVersion(id, stored, ctx.user.id, { endSession: true });
    const attachment = await this.prisma.attachment.findUnique({ where: { id }, include });
    if (!attachment) throw Errors.notFound();
    return this.toDto(attachment, true);
  }

  async load(user: AuthUser, id: string, need: 'view' | 'edit') {
    const attachment = await this.prisma.attachment.findUnique({ where: { id }, include });
    if (!attachment) throw Errors.notFound();
    const access = await this.permissions.requirePage(user, attachment.pageId, need);
    return { attachment, access };
  }

  /**
   * Öffnet eine gespeicherte Datei als StreamableFile. Nur Bilder und PDF werden inline angezeigt;
   * alles andere kommt als application/octet-stream mit Content-Disposition: attachment (S7).
   */
  async stream(file: { storageKey: string; mimeType: string; sizeBytes: number }, filename: string, forceDownload: boolean): Promise<StreamableFile> {
    const inline = previewOf(file.mimeType) !== null && !forceDownload;
    const stream = this.storage.open(file.storageKey);
    // Datei fehlt auf der Platte: als 404 melden statt die Verbindung abzubrechen
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', reject);
    }).catch((err) => {
      this.logger.error(`Datei ${file.storageKey} fehlt: ${String(err)}`);
      throw Errors.notFound();
    });
    return new StreamableFile(stream, {
      type: inline ? file.mimeType : 'application/octet-stream',
      disposition: contentDisposition(inline ? 'inline' : 'attachment', filename),
      length: file.sizeBytes,
    });
  }

  /** Liefert die aktuelle Fassung mit Rechteprüfung aus; hat der Browser sie schon, ohne Inhalt */
  async download(user: AuthUser, id: string, forceDownload: boolean, ifNoneMatch?: string): Promise<AttachmentDownload> {
    const { attachment } = await this.load(user, id, 'view');
    const etag = `"${attachment.sha256}"`;
    if (etagMatches(ifNoneMatch, etag)) return { file: null, etag };
    return { file: await this.stream(attachment, attachment.filename, forceDownload), etag };
  }

  async versions(user: AuthUser, id: string): Promise<AttachmentVersionDto[]> {
    await this.load(user, id, 'view');
    const rows = await this.prisma.attachmentVersion.findMany({
      where: { attachmentId: id },
      include: { createdBy: { select: { id: true, displayName: true } } },
      orderBy: { version: 'desc' },
    });
    return rows.map((v) => ({
      version: v.version,
      sizeBytes: v.sizeBytes,
      createdBy: userRef(v.createdBy),
      createdAt: v.createdAt.toISOString(),
      url: `/api/v1/attachments/${id}/versions/${v.version}`,
    }));
  }

  /** Datei einer Fassung ohne Rechteprüfung; vorher load() aufrufen */
  async versionFile(attachmentId: string, version: number): Promise<{ storageKey: string; version: number }> {
    const row = await this.prisma.attachmentVersion.findUnique({
      where: { attachmentId_version: { attachmentId, version } },
      select: { storageKey: true, version: true },
    });
    if (!row) throw Errors.notFound();
    return row;
  }

  /**
   * Ältere Fassungen gibt es zum Herunterladen; der Dateiname bekommt die Fassung angehängt.
   * Mit inline zeigt der Browser Bilder und PDF an (Zeichnungen auf Seiten verweisen auf eine feste Fassung).
   */
  async downloadVersion(user: AuthUser, id: string, version: number, inline = false, ifNoneMatch?: string): Promise<AttachmentDownload> {
    const { attachment } = await this.load(user, id, 'view');
    const row = await this.prisma.attachmentVersion.findUnique({ where: { attachmentId_version: { attachmentId: id, version } } });
    if (!row) throw Errors.notFound();
    const etag = `"${row.sha256}"`;
    if (etagMatches(ifNoneMatch, etag)) return { file: null, etag };
    const dot = attachment.filename.lastIndexOf('.');
    const filename = dot > 0 ? `${attachment.filename.slice(0, dot)} (Fassung ${version})${attachment.filename.slice(dot)}` : `${attachment.filename} (Fassung ${version})`;
    return { file: await this.stream(row, filename, !inline), etag };
  }

  /**
   * Legt eine gespeicherte Datei als neue Fassung an. Gleicher Inhalt wie die aktuelle Fassung ergibt keine neue.
   * endSession setzt den Schlüssel der Office-Bearbeitung zurück, damit die nächste Bearbeitung neu lädt.
   * Ergebnis: die neue Fassungsnummer oder null, wenn nichts gespeichert wurde.
   */
  async addVersion(attachmentId: string, stored: StoredFile, userId: string | null, opts: { endSession: boolean }): Promise<number | null> {
    const file = { mimeType: detectType(stored.head).mimeType, sizeBytes: stored.sizeBytes, storageKey: stored.storageKey, sha256: stored.sha256 };
    const result = await this.prisma.$transaction(async (tx) => {
      // Zeile sperren, damit zwei Speichervorgänge nicht dieselbe Nummer vergeben
      await tx.$executeRaw`SELECT 1 FROM attachments WHERE id = ${attachmentId}::uuid FOR UPDATE`;
      const current = await tx.attachment.findUnique({ where: { id: attachmentId } });
      if (!current) return { version: null, unchanged: false };
      if (current.sha256 === stored.sha256) {
        if (opts.endSession) await tx.attachment.update({ where: { id: attachmentId }, data: { officeKey: null } });
        return { version: null, unchanged: true };
      }
      const version = current.version + 1;
      await tx.attachmentVersion.create({ data: { attachmentId, version, ...file, createdById: userId } });
      await tx.attachment.update({
        where: { id: attachmentId },
        data: { ...file, version, updatedAt: new Date(), ...(opts.endSession ? { officeKey: null } : {}) },
      });
      return { version, unchanged: false };
    });
    // Nicht übernommene Datei (gleicher Inhalt oder Anhang inzwischen gelöscht) nicht liegen lassen
    if (result.version === null) await this.storage.remove([stored.storageKey]);
    return result.version;
  }

  async remove(id: string, ctx: AuthContext, ip: string): Promise<void> {
    const { attachment, access } = await this.load(ctx.user, id, 'edit');
    const versions = await this.prisma.attachmentVersion.findMany({ where: { attachmentId: id }, select: { storageKey: true } });
    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.remove([...new Set([attachment.storageKey, ...versions.map((v) => v.storageKey)])]);
    await this.audit.log({
      action: 'attachment.deleted',
      actorId: ctx.user.id,
      targetType: 'attachment',
      targetId: id,
      ip,
      details: { spaceKey: access.space.key, pageId: attachment.pageId, filename: attachment.filename },
    });
  }
}
