import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { clientNet } from '../common/request-context';
import { CryptoService } from '../infra/crypto.service';
import { PrismaService } from '../infra/prisma.service';
import { RateLimitService } from '../infra/rate-limit.service';
import { MailService } from '../mail/mail.service';
import { PasswordService } from './password.service';
import { ActiveSession, SessionService } from './session.service';
import { TotpService } from './totp.service';

export const INVITATION_VALID_HOURS = 72;
export const RESET_VALID_MINUTES = 60;

export interface ClientInfo {
  ip: string;
  userAgent: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    private readonly limiter: RateLimitService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private accountKey(email: string) {
    return this.crypto.hmac(`acct:${email}`).slice(0, 32);
  }

  // ---------- Login (Stufe 1: Passwort) ----------

  async login(email: string, password: string, client: ClientInfo): Promise<ActiveSession> {
    const acct = this.accountKey(email);
    await this.limiter.enforce([
      { key: `login:ip:${client.ip}`, limit: this.config.RATE_LOGIN_PER_MINUTE, windowSec: 60 },
      { key: `login:acct:${acct}`, limit: this.config.RATE_LOGIN_ACCOUNT_PER_MINUTE, windowSec: 60 },
    ]);
    // Steigende Sperre nach Fehlversuchen je Konto und Netz des Absenders: Wer von woanders falsch rät, sperrt
    // den Kontoinhaber nicht aus (SEC-002). Gilt gleichermaßen für unbekannte Adressen (S10).
    const lockScope = `login:${acct}:${clientNet(client.ip)}`;
    await this.limiter.assertNotLocked(lockScope);

    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok =
      user?.passwordHash && user.status === 'active'
        ? await this.passwords.verify(user.passwordHash, password)
        : await this.passwords.verifyDummy(password);

    if (!user || !ok || user.status !== 'active') {
      await this.limiter.registerFailure(lockScope);
      if (user) {
        // Nicht abwarten, damit bekannte und unbekannte Adressen gleich lange brauchen (S10)
        void this.prisma.user
          .update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } })
          .catch(() => undefined);
      }
      await this.audit.log({
        action: 'auth.login.failed',
        actorId: user?.id ?? null,
        targetType: 'user',
        targetId: user?.id,
        ip: client.ip,
        details: user ? { reason: user.status !== 'active' ? `status_${user.status}` : 'password' } : { reason: 'unknown_email' },
      });
      throw Errors.invalidCredentials();
    }

    await this.limiter.clearFailures(lockScope);
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log({ action: 'auth.login.password_ok', actorId: user.id, ip: client.ip });
    return this.sessions.create(user.id, user.totpEnabled ? 'password' : 'totp_setup', client.ip, client.userAgent);
  }

  // ---------- Login (Stufe 2: TOTP oder Wiederherstellungscode) ----------

  async verifySecondFactor(session: ActiveSession, code: string, client: ClientInfo): Promise<ActiveSession> {
    const scope = `2fa:${session.userId}`;
    await this.limiter.enforce([
      { key: `2fa:ip:${client.ip}`, limit: this.config.RATE_LOGIN_PER_MINUTE, windowSec: 60 },
      { key: `2fa:acct:${session.userId}`, limit: this.config.RATE_LOGIN_PER_MINUTE, windowSec: 60 },
    ]);
    await this.limiter.assertNotLocked(scope);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    let method: 'totp' | 'recovery_code' | null = null;
    if (/^\d{6}$/.test(code)) {
      if (await this.consumeTotp(user, code)) method = 'totp';
    } else if (await this.consumeRecoveryCode(user.id, code)) {
      method = 'recovery_code';
    }

    if (!method) {
      const failures = await this.limiter.registerFailure(scope);
      await this.audit.log({ action: 'auth.2fa.failed', actorId: user.id, ip: client.ip, details: { failures } });
      throw Errors.invalidCode();
    }

    await this.limiter.clearFailures(scope);
    const full = await this.sessions.rotate(session, 'full', client.ip, client.userAgent);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ action: 'auth.login.success', actorId: user.id, ip: client.ip, details: { method } });
    if (method === 'recovery_code') {
      const left = await this.prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } });
      await this.audit.log({ action: 'auth.recovery_code.used', actorId: user.id, ip: client.ip, details: { left } });
    }
    return full;
  }

  /** Prüft einen TOTP-Code und verbraucht ihn, sodass er nicht ein zweites Mal gilt (S2). */
  async consumeTotp(user: Pick<User, 'id' | 'totpSecret' | 'totpEnabled'>, code: string): Promise<boolean> {
    if (!user.totpEnabled || !user.totpSecret) return false;
    const step = this.totp.matchStep(code, this.crypto.decrypt(user.totpSecret));
    if (step === null) return false;
    // Atomar: nur wenn der Schritt neuer ist als der zuletzt verwendete
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return count === 1;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const hash = this.totp.hashRecoveryCode(code);
    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { userId, codeHash: hash, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  // ---------- 2FA einrichten ----------

  async startTotpSetup(session: ActiveSession, email: string) {
    const secret = this.totp.generateSecret();
    await this.sessions.update(session, { pendingTotpSecret: this.crypto.encrypt(secret) });
    return this.totp.setupData(secret, email);
  }

  async confirmTotpSetup(session: ActiveSession, code: string, client: ClientInfo) {
    if (!session.pendingTotpSecret) throw Errors.badRequest('Bitte die Einrichtung zuerst starten.', 'SETUP_NOT_STARTED');
    await this.limiter.enforce([
      { key: `2fa-setup:acct:${session.userId}`, limit: this.config.RATE_LOGIN_PER_MINUTE, windowSec: 60 },
    ]);
    const secret = this.crypto.decrypt(session.pendingTotpSecret);
    const step = this.totp.matchStep(code, secret);
    if (step === null) {
      await this.audit.log({ action: 'auth.2fa.setup.failed', actorId: session.userId, ip: client.ip });
      throw Errors.invalidCode();
    }

    const codes = this.totp.generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: session.userId },
        data: {
          totpSecret: this.crypto.encrypt(secret),
          totpEnabled: true,
          totpLastStep: step,
          lastLoginAt: new Date(),
        },
      }),
      this.prisma.recoveryCode.deleteMany({ where: { userId: session.userId } }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((c) => ({ userId: session.userId, codeHash: this.totp.hashRecoveryCode(c) })),
      }),
    ]);
    const full = await this.sessions.rotate(session, 'full', client.ip, client.userAgent);
    await this.audit.log({ action: 'auth.2fa.setup', actorId: session.userId, ip: client.ip });
    await this.audit.log({ action: 'auth.login.success', actorId: session.userId, ip: client.ip, details: { method: 'totp_setup' } });
    return { session: full, recoveryCodes: codes };
  }

  /**
   * Bestätigung einer heiklen Aktion mit dem aktuellen 2FA-Code (z. B. neue Wiederherstellungscodes, API-Token).
   * Wirft 401 INVALID_CODE; Fehlversuche landen im Audit-Log und zählen für fail2ban.
   */
  async confirmTotp(userId: string, totpCode: string, client: ClientInfo, context: string): Promise<void> {
    await this.limiter.enforce([{ key: `2fa-confirm:acct:${userId}`, limit: this.config.RATE_LOGIN_PER_MINUTE, windowSec: 60 }]);
    // Steigende Sperre wie bei der Anmeldung: Mit einer erbeuteten Sitzung lässt sich der Code so nicht erraten (SEC-008)
    const scope = `2fa-confirm:${userId}`;
    await this.limiter.assertNotLocked(scope);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.consumeTotp(user, totpCode))) {
      const failures = await this.limiter.registerFailure(scope);
      await this.audit.log({ action: 'auth.2fa.failed', actorId: userId, ip: client.ip, details: { context, failures } });
      throw Errors.invalidCode();
    }
    await this.limiter.clearFailures(scope);
  }

  async regenerateRecoveryCodes(userId: string, totpCode: string, client: ClientInfo): Promise<string[]> {
    await this.confirmTotp(userId, totpCode, client, 'recovery_codes');
    const codes = this.totp.generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: this.totp.hashRecoveryCode(c) })) }),
    ]);
    await this.audit.log({ action: 'auth.recovery_codes.regenerated', actorId: userId, ip: client.ip });
    return codes;
  }

  // ---------- Einladungen ----------

  /** Legt eine neue Einladung an; ältere offene Einladungen werden ungültig. Liefert den Link. */
  async createInvitation(user: Pick<User, 'id' | 'email' | 'displayName'>, invitedBy: string | null): Promise<string> {
    const token = this.crypto.randomToken(32);
    await this.prisma.$transaction([
      this.prisma.invitation.updateMany({
        where: { userId: user.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.invitation.create({
        data: {
          userId: user.id,
          email: user.email,
          tokenHash: this.crypto.sha256(token),
          invitedBy,
          expiresAt: new Date(Date.now() + INVITATION_VALID_HOURS * 3600 * 1000),
        },
      }),
    ]);
    const url = `${this.config.APP_ORIGIN}/invite/${token}`;
    this.mail.send({
      to: user.email,
      subject: 'Einladung zu wikifordummys',
      text:
        `Hallo ${user.displayName},\n\ndu wurdest zu wikifordummys eingeladen. ` +
        `Über diesen Link legst du dein Passwort fest und richtest die Zwei-Faktor-Anmeldung ein:\n\n${url}\n\n` +
        `Der Link ist ${INVITATION_VALID_HOURS} Stunden gültig.`,
    });
    return url;
  }

  private async findOpenInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
      include: { user: true },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date() ||
      invitation.user.status !== 'invited'
    ) {
      throw Errors.invalidToken();
    }
    return invitation;
  }

  async describeInvitation(token: string, client: ClientInfo) {
    await this.limiter.enforce([{ key: `invite:ip:${client.ip}`, limit: 30, windowSec: 3600 }]);
    const inv = await this.findOpenInvitation(token);
    return { email: inv.user.email, displayName: inv.user.displayName };
  }

  async acceptInvitation(token: string, password: string, displayName: string | undefined, client: ClientInfo) {
    await this.limiter.enforce([{ key: `invite:ip:${client.ip}`, limit: 30, windowSec: 3600 }]);
    const inv = await this.findOpenInvitation(token);
    this.passwords.assertPolicy(password, inv.user.email);
    const passwordHash = await this.passwords.hash(password);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (count !== 1) throw Errors.invalidToken();
      await tx.user.update({
        where: { id: inv.userId },
        data: { passwordHash, status: 'active', displayName: displayName || inv.user.displayName },
      });
    });
    await this.audit.log({ action: 'auth.invite.accepted', actorId: inv.userId, ip: client.ip });
    // Vor dem Zugriff auf Inhalte muss 2FA eingerichtet werden
    return this.sessions.create(inv.userId, 'totp_setup', client.ip, client.userAgent);
  }

  // ---------- Passwort vergessen ----------

  async requestPasswordReset(email: string, client: ClientInfo): Promise<void> {
    await this.limiter.enforce([
      { key: `reset:ip:${client.ip}`, limit: this.config.RATE_RESET_PER_HOUR, windowSec: 3600 },
      { key: `reset:acct:${this.accountKey(email)}`, limit: this.config.RATE_RESET_PER_HOUR, windowSec: 3600 },
    ]);
    const user = await this.prisma.user.findUnique({ where: { email } });
    await this.audit.log({
      action: 'auth.password.reset_requested',
      actorId: user?.id ?? null,
      ip: client.ip,
      details: user ? {} : { reason: 'unknown_email' },
    });
    // Gleiche Antwort für unbekannte und inaktive Konten (S10); Mail-Versand blockiert nicht
    if (!user || user.status !== 'active') return;

    const token = this.crypto.randomToken(32);
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.sha256(token),
        expiresAt: new Date(Date.now() + RESET_VALID_MINUTES * 60 * 1000),
      },
    });
    this.mail.send({
      to: user.email,
      subject: 'Passwort zurücksetzen – wikifordummys',
      text:
        `Hallo ${user.displayName},\n\nüber diesen Link setzt du ein neues Passwort ` +
        `(${RESET_VALID_MINUTES} Minuten gültig):\n\n${this.config.APP_ORIGIN}/reset-password/${token}\n\n` +
        `Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren.`,
    });
  }

  async resetPassword(token: string, password: string, client: ClientInfo): Promise<void> {
    await this.limiter.enforce([{ key: `reset-confirm:ip:${client.ip}`, limit: 10, windowSec: 3600 }]);
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date() || reset.user.status !== 'active') {
      throw Errors.invalidToken();
    }
    this.passwords.assertPolicy(password, reset.user.email);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordReset.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count < 1) throw Errors.invalidToken();
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    });
    // Alle Sitzungen beenden (S4) und API-Tokens widerrufen; die 2FA bleibt bestehen
    await this.sessions.destroyAllForUser(reset.userId);
    await this.revokeApiTokens(reset.userId);
    await this.audit.log({ action: 'auth.password.reset', actorId: reset.userId, ip: client.ip });
  }

  /** Widerruft alle API-Tokens (MCP) eines Kontos, z. B. wenn ein Fremder das Passwort kennen könnte */
  async revokeApiTokens(userId: string): Promise<number> {
    const { count } = await this.prisma.apiToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return count;
  }

  // ---------- Passwort ändern ----------

  async changePassword(session: ActiveSession, currentPassword: string, newPassword: string, client: ClientInfo) {
    await this.limiter.enforce([
      { key: `pwchange:acct:${session.userId}`, limit: this.config.RATE_LOGIN_PER_MINUTE, windowSec: 60 },
    ]);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    if (!user.passwordHash || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      await this.audit.log({ action: 'auth.password.change.failed', actorId: user.id, ip: client.ip });
      throw Errors.badRequest('Das aktuelle Passwort ist falsch.', 'INVALID_PASSWORD');
    }
    this.passwords.assertPolicy(newPassword, user.email);
    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw Errors.badRequest('Das neue Passwort muss sich vom bisherigen unterscheiden.', 'SAME_PASSWORD');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    // Passwortänderung beendet alle anderen Sitzungen (S4)
    const ended = await this.sessions.destroyAllForUser(user.id, session.id);
    await this.audit.log({ action: 'auth.password.changed', actorId: user.id, ip: client.ip, details: { endedSessions: ended } });
  }

  // ---------- Startpasswort (nur Kommandozeile) ----------

  /**
   * Setzt ein zufälliges Startpasswort, das nach der nächsten Anmeldung geändert werden muss.
   * Für den ersten Administrator und für den Fall, dass der Mailversand nicht funktioniert.
   * Eingeladene Konten werden dabei aktiviert, offene Einladungen ungültig; alle Sitzungen und API-Tokens enden.
   * Die eingerichtete 2FA bleibt bestehen.
   */
  async issueStartPassword(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === 'deactivated') throw new Error(`Das Konto ${user.email} ist deaktiviert.`);
    const password = this.passwords.generate();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await this.passwords.hash(password),
          mustChangePassword: true,
          status: 'active',
          failedLogins: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.invitation.updateMany({
        where: { userId: user.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.limiter.clearFailuresByPrefix(`login:${this.accountKey(user.email)}:`);
    const ended = await this.sessions.destroyAllForUser(user.id);
    const revokedTokens = await this.revokeApiTokens(user.id);
    await this.audit.log({
      action: 'cli.password.issued',
      targetType: 'user',
      targetId: user.id,
      details: { email: user.email, endedSessions: ended, revokedTokens },
    });
    return password;
  }
}
