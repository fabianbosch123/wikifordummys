import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import type { MailSettingsDto as MailSettingsResponse } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { AdminOnly, Auth } from '../common/decorators';
import { ApiError } from '../common/errors';
import { AuthContext, clientIp, WikiRequest } from '../common/request-context';
import { MailService, SmtpError, SmtpSettings } from '../mail/mail.service';
import { MailSettingsDto, TestMailDto } from './settings.dto';

const smtpFailed = (err: unknown) =>
  err instanceof SmtpError ? new ApiError(422, 'SMTP_FAILED', err.message) : err;

/** Einstellungen, die Administratoren ohne Zugriff auf den Server ändern können (M4: Mailversand) */
@AdminOnly()
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  @Get('mail')
  getMail(): MailSettingsResponse {
    return this.mail.describe();
  }

  /** Speichert den SMTP-Zugang; vorher wird die Anmeldung am Server geprüft (abschaltbar mit skipVerify) */
  @Put('mail')
  async putMail(@Body() dto: MailSettingsDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest): Promise<MailSettingsResponse> {
    const previous = this.mail.settings();
    const settings: SmtpSettings = {
      host: dto.host.replace(/^\[|\]$/g, ''),
      port: dto.port,
      security: dto.security,
      username: dto.username ?? '',
      // Ohne neues Passwort bleibt das bisherige, auch wenn es bisher aus .env kam
      password: dto.password ?? previous?.password ?? '',
      from: dto.from,
    };
    if (!settings.username) settings.password = '';
    if (!dto.skipVerify) {
      await this.mail.verify(settings).catch((err) => {
        throw smtpFailed(err);
      });
    }
    await this.mail.save(settings, ctx.user.id);
    await this.audit.log({
      action: 'admin.settings.mail.updated',
      actorId: ctx.user.id,
      targetType: 'setting',
      targetId: 'mail',
      ip: clientIp(req),
      details: {
        host: settings.host,
        port: settings.port,
        security: settings.security,
        username: settings.username,
        from: settings.from,
        passwordChanged: dto.password !== undefined,
        verified: !dto.skipVerify,
      },
    });
    return this.mail.describe();
  }

  /** Verwirft die Einstellungen aus der Administration; danach gilt wieder SMTP_URL aus .env */
  @Delete('mail')
  async deleteMail(@Auth() ctx: AuthContext, @Req() req: WikiRequest): Promise<MailSettingsResponse> {
    await this.mail.resetToEnv();
    await this.audit.log({
      action: 'admin.settings.mail.reset',
      actorId: ctx.user.id,
      targetType: 'setting',
      targetId: 'mail',
      ip: clientIp(req),
    });
    return this.mail.describe();
  }

  /** Sendet eine Testmail mit den gespeicherten Einstellungen, standardmäßig an die eigene Adresse */
  @Post('mail/test')
  @HttpCode(200)
  async testMail(@Body() dto: TestMailDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    const to = dto.to ?? ctx.user.email;
    let error: string | null = null;
    try {
      await this.mail.sendNow({
        to,
        subject: 'Testmail von wikifordummys',
        text: `Hallo,\n\ndiese Testmail wurde von ${ctx.user.displayName} in der Administration ausgelöst.\nDer Mailversand des Wikis funktioniert.\n`,
      });
    } catch (err) {
      error = err instanceof SmtpError ? err.message : 'Versand fehlgeschlagen.';
    }
    await this.audit.log({
      action: error ? 'admin.settings.mail.test_failed' : 'admin.settings.mail.tested',
      actorId: ctx.user.id,
      targetType: 'setting',
      targetId: 'mail',
      ip: clientIp(req),
      details: { to, ...(error ? { error } : {}) },
    });
    if (error) throw new ApiError(422, 'SMTP_FAILED', error);
    return { sent: true, to };
  }
}
