import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MailSettingsDto, SmtpSecurity } from '@wiki/shared';
import nodemailer, { Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from '../config';
import { CryptoService } from '../infra/crypto.service';
import { PrismaService } from '../infra/prisma.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** SMTP-Zugang, wie ihn Installer (.env) oder Administration festlegen */
export interface SmtpSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  from: string;
}

/** Gespeicherte Form in der Tabelle settings (Schlüssel "mail") */
interface StoredMailSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  passwordEnc: string | null;
  from: string;
}

export const MAIL_SETTING_KEY = 'mail';

export class SmtpError extends Error {}

const DEFAULT_PORTS: Record<SmtpSecurity, number> = { tls: 465, starttls: 587, none: 25 };

/**
 * Liest SMTP_URL aus .env (z. B. smtps://benutzer:passwort@smtp.example.de:465).
 * smtps:// bedeutet TLS ab Verbindungsbeginn; smtp:// verlangt STARTTLS, außer bei ?tls=off (nur für lokale Testserver).
 */
export function parseSmtpUrl(raw: string, from: string): SmtpSettings {
  const url = new URL(raw);
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') {
    throw new Error('SMTP_URL muss mit smtp:// oder smtps:// beginnen');
  }
  const plain = url.searchParams.get('tls') === 'off' || url.searchParams.get('ignoreTLS') === 'true';
  const security: SmtpSecurity = url.protocol === 'smtps:' ? 'tls' : plain ? 'none' : 'starttls';
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port ? Number(url.port) : DEFAULT_PORTS[security],
    security,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    from,
  };
}

export function createSmtpTransport(s: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    auth: s.username ? { user: s.username, pass: s.password } : undefined,
    // Ein nicht erreichbarer Server soll die Testmail nicht minutenlang hängen lassen
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/** Verständliche Meldung für die häufigsten SMTP-Fehler, die Originalmeldung bleibt angehängt */
function explain(err: Error & { code?: string; responseCode?: number }): string {
  const hints: Record<string, string> = {
    EAUTH: 'Anmeldung am Mailserver abgelehnt (Benutzername oder Passwort prüfen)',
    ECONNECTION: 'Keine Verbindung zum Mailserver (Server, Port und Verschlüsselung prüfen; manche VPS-Anbieter sperren ausgehende Mail-Ports)',
    ETIMEDOUT: 'Zeitüberschreitung beim Verbindungsaufbau (Firewall oder gesperrter Port?)',
    EDNS: 'Servername nicht gefunden',
    ESOCKET: 'Verbindungs- oder TLS-Fehler (passt die Verschlüsselung zum Port?)',
    EENVELOPE: 'Absender oder Empfänger abgelehnt',
    EMESSAGE: 'Nachricht vom Server abgelehnt',
  };
  const hint = /ECONNREFUSED/.test(err.message)
    ? 'Verbindung abgelehnt (Server oder Port falsch?)'
    : ((err.code && hints[err.code]) ?? 'Versand fehlgeschlagen');
  return `${hint}: ${err.message}`;
}

/**
 * Versand per SMTP. Der Zugang kommt aus der Administration (Tabelle settings, Vorrang) oder aus SMTP_URL in .env.
 * Ohne beides werden Mails nur ins Log geschrieben (Entwicklung).
 * Der normale Versand blockiert die Anfrage nicht, damit die Antwortzeit nichts verrät (S10).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger('Mail');
  private transport: Transporter | null = null;
  private current: SmtpSettings | null = null;
  private source: MailSettingsDto['source'] = 'none';
  private updatedAt: Date | null = null;
  /** In Tests einsehbar */
  readonly outbox: MailMessage[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  /** SMTP-Zugang aus .env, falls gesetzt */
  envSettings(): SmtpSettings | null {
    if (!this.config.SMTP_URL) return null;
    try {
      return parseSmtpUrl(this.config.SMTP_URL, this.config.MAIL_FROM);
    } catch (err) {
      throw new Error(`SMTP_URL in .env ist ungültig: ${(err as Error).message}`);
    }
  }

  /** Lädt die gültigen Einstellungen neu (nach Änderung in der Administration) */
  async reload(): Promise<void> {
    const row = await this.prisma.setting.findUnique({ where: { key: MAIL_SETTING_KEY } });
    this.transport?.close();
    if (row) {
      const stored = row.value as unknown as StoredMailSettings;
      let password = '';
      try {
        password = stored.passwordEnc ? this.crypto.decrypt(stored.passwordEnc) : '';
      } catch {
        // Passiert nur, wenn ENCRYPTION_KEY geändert wurde; die API startet trotzdem
        this.logger.error('SMTP-Passwort aus der Administration lässt sich nicht entschlüsseln (ENCRYPTION_KEY geändert?)');
      }
      this.current = {
        host: stored.host,
        port: stored.port,
        security: stored.security,
        username: stored.username,
        password,
        from: stored.from,
      };
      this.source = 'admin';
      this.updatedAt = row.updatedAt;
    } else {
      this.current = this.envSettings();
      this.source = this.current ? 'env' : 'none';
      this.updatedAt = null;
    }
    this.transport = this.current ? createSmtpTransport(this.current) : null;
  }

  /** Gültige Einstellungen inklusive Passwort, nur für den Server */
  settings(): SmtpSettings | null {
    return this.current;
  }

  describe(): MailSettingsDto {
    const s = this.current;
    return {
      source: this.source,
      host: s?.host ?? '',
      port: s?.port ?? 587,
      security: s?.security ?? 'starttls',
      username: s?.username ?? '',
      hasPassword: Boolean(s?.password),
      from: s?.from ?? this.config.MAIL_FROM,
      envConfigured: Boolean(this.config.SMTP_URL),
      updatedAt: this.updatedAt?.toISOString() ?? null,
    };
  }

  async save(settings: SmtpSettings, updatedBy: string | null): Promise<void> {
    const value: StoredMailSettings = {
      host: settings.host,
      port: settings.port,
      security: settings.security,
      username: settings.username,
      passwordEnc: settings.password ? this.crypto.encrypt(settings.password) : null,
      from: settings.from,
    };
    await this.prisma.setting.upsert({
      where: { key: MAIL_SETTING_KEY },
      create: { key: MAIL_SETTING_KEY, value: value as unknown as Prisma.InputJsonValue, updatedBy },
      update: { value: value as unknown as Prisma.InputJsonValue, updatedBy },
    });
    await this.reload();
  }

  /** Entfernt die Einstellungen aus der Administration; danach gilt wieder .env */
  async resetToEnv(): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { key: MAIL_SETTING_KEY } });
    await this.reload();
  }

  /** Prüft Verbindung und Anmeldung, ohne eine Mail zu senden */
  async verify(settings: SmtpSettings): Promise<void> {
    const transport = createSmtpTransport(settings);
    try {
      await transport.verify();
    } catch (err) {
      throw new SmtpError(explain(err as Error));
    } finally {
      transport.close();
    }
  }

  /** Sendet sofort und wartet auf das Ergebnis (Testmail aus Administration oder Kommandozeile) */
  async sendNow(message: MailMessage, settings: SmtpSettings | null = this.current): Promise<void> {
    if (!settings) throw new SmtpError('Es ist kein Mailserver eingerichtet.');
    const transport = createSmtpTransport(settings);
    try {
      await transport.sendMail({ from: settings.from, ...message });
    } catch (err) {
      throw new SmtpError(explain(err as Error));
    } finally {
      transport.close();
    }
  }

  send(message: MailMessage): void {
    if (this.config.NODE_ENV === 'test') {
      this.outbox.push(message);
      return;
    }
    if (!this.transport || !this.current) {
      // In Produktion keine Links mit Tokens ins Log schreiben
      const body = this.config.NODE_ENV === 'production' ? '' : `\n${message.text}`;
      this.logger.log(`(kein SMTP konfiguriert) Mail an ${message.to}: ${message.subject}${body}`);
      return;
    }
    this.transport
      .sendMail({ from: this.current.from, ...message })
      .catch((err: Error) => this.logger.error(`Mail an ${message.to} fehlgeschlagen: ${err.message}`));
  }
}
