import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Versand per SMTP. Ohne SMTP_URL werden Mails nur ins Log geschrieben (Entwicklung).
 * Der Versand blockiert die Anfrage nicht, damit die Antwortzeit nichts verrät (S10).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter | null;
  /** In Tests einsehbar */
  readonly outbox: MailMessage[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  send(message: MailMessage): void {
    if (this.config.NODE_ENV === 'test') {
      this.outbox.push(message);
      return;
    }
    if (!this.transport) {
      // In Produktion keine Links mit Tokens ins Log schreiben
      const body = this.config.NODE_ENV === 'production' ? '' : `\n${message.text}`;
      this.logger.log(`(kein SMTP konfiguriert) Mail an ${message.to}: ${message.subject}${body}`);
      return;
    }
    this.transport
      .sendMail({ from: this.config.MAIL_FROM, ...message })
      .catch((err: Error) => this.logger.error(`Mail an ${message.to} fehlgeschlagen: ${err.message}`));
  }
}
