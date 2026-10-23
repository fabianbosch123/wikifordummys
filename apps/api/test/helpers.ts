import type { INestApplication } from '@nestjs/common';
import { SYSTEM_GROUPS } from '@wiki/shared';
import type Redis from 'ioredis';
import { authenticator } from 'otplib';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AuthService } from '../src/auth/auth.service';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { PrismaService } from '../src/infra/prisma.service';
import { REDIS } from '../src/infra/redis';
import { MailService } from '../src/mail/mail.service';

export const ORIGIN = 'http://wiki.test';
export const PASSWORD = 'ein-sehr-sicheres-passwort';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  redis: Redis;
  mail: MailService;
}

export async function startApp(): Promise<TestContext> {
  const app = await createApp(loadConfig());
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    redis: app.get(REDIS),
    mail: app.get(MailService),
  };
}

/** Leert alle Tabellen außer den Systemgruppen und die Test-Redis-DB. */
export async function resetState(ctx: TestContext) {
  await ctx.prisma.$executeRaw`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update`;
  await ctx.prisma.$executeRaw`TRUNCATE attachments, page_restrictions, space_permissions, page_versions, pages, spaces, audit_log, recovery_codes, invitations, password_resets, group_members, users CASCADE`;
  await ctx.prisma.$executeRaw`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update`;
  await ctx.prisma.group.deleteMany({ where: { system: false } });
  // Globale Rechte der Systemgruppen wie nach der Migration
  await ctx.prisma.$executeRaw`
    INSERT INTO global_permissions (group_id, permission)
    SELECT id, 'create_space'::"GlobalPermissionType" FROM groups WHERE name = 'alle-benutzer'
    ON CONFLICT DO NOTHING`;
  await ctx.redis.flushdb();
  ctx.mail.outbox.length = 0;
}

/** Browser-ähnlicher Client: Cookies, CSRF-Header und Origin werden automatisch gesetzt. */
export class Client {
  readonly agent: TestAgent;
  csrf = '';

  constructor(
    ctx: TestContext,
    readonly ip = '10.0.0.1',
  ) {
    this.agent = request.agent(ctx.app.getHttpServer());
  }

  async init() {
    const res = await this.get('/auth/csrf').expect(200);
    this.csrf = res.body.csrfToken;
    return this;
  }

  get(path: string) {
    return this.agent.get(`/api/v1${path}`).set('X-Forwarded-For', this.ip);
  }

  private mutate(method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) {
    const req = this.agent[method](`/api/v1${path}`)
      .set('X-Forwarded-For', this.ip)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', this.csrf);
    return body ? req.send(body) : req;
  }

  async post(path: string, body?: object) {
    const res = await this.mutate('post', path, body);
    if (res.body?.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }

  put(path: string, body?: object) {
    return this.mutate('put', path, body);
  }

  patch(path: string, body?: object) {
    return this.mutate('patch', path, body);
  }

  delete(path: string) {
    return this.mutate('delete', path);
  }

  /** Lädt eine Datei wie die Weboberfläche hoch: Inhalt als Body, Name als Parameter */
  upload(pageId: string, filename: string, data: Buffer, contentType = 'application/octet-stream') {
    return this.mutate('post', `/pages/${pageId}/attachments?filename=${encodeURIComponent(filename)}`)
      .set('Content-Type', contentType)
      .send(data);
  }
}

export function inviteTokenFromMail(ctx: TestContext, email: string): string {
  const mail = [...ctx.mail.outbox].reverse().find((m) => m.to === email && m.subject.startsWith('Einladung'));
  const match = mail?.text.match(/\/invite\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`Keine Einladung an ${email}`);
  return match[1];
}

export function totpAt(secret: string, epochMs: number): string {
  return authenticator.clone({ epoch: epochMs }).generate(secret);
}

export interface Account {
  client: Client;
  userId: string;
  email: string;
  secret: string;
  recoveryCodes: string[];
}

/** Lädt ein Konto ein, nimmt die Einladung an und richtet 2FA ein. */
export async function createUser(
  ctx: TestContext,
  email: string,
  opts: { admin?: boolean; ip?: string } = {},
): Promise<Account> {
  const auth = ctx.app.get(AuthService);
  const groups = opts.admin
    ? { create: [{ group: { connect: { name: SYSTEM_GROUPS.ADMINS } } }] }
    : undefined;
  const user = await ctx.prisma.user.create({ data: { email, displayName: email.split('@')[0], groups } });
  await auth.createInvitation(user, null);
  const client = await new Client(ctx, opts.ip).init();
  await client.post('/auth/invite/accept', { token: inviteTokenFromMail(ctx, email), password: PASSWORD }).then((r) => {
    if (r.status !== 200) throw new Error(`Einladung fehlgeschlagen: ${JSON.stringify(r.body)}`);
  });
  const setup = await client.post('/auth/2fa/setup');
  const secret: string = setup.body.secret;
  const confirm = await client.post('/auth/2fa/setup/confirm', { code: totpAt(secret, Date.now()) });
  if (confirm.status !== 200) throw new Error(`2FA-Einrichtung fehlgeschlagen: ${JSON.stringify(confirm.body)}`);
  return { client, userId: user.id, email, secret, recoveryCodes: confirm.body.recoveryCodes };
}

/**
 * Meldet sich mit Passwort und TOTP an. Der Einmal-Schutz wird vorher zurückgesetzt,
 * damit mehrere Logins im selben 30-Sekunden-Fenster möglich sind.
 */
export async function login(ctx: TestContext, account: Account, ip = '10.0.0.2'): Promise<Client> {
  const client = await new Client(ctx, ip).init();
  const pw = await client.post('/auth/login', { email: account.email, password: PASSWORD });
  if (pw.status !== 200) throw new Error(`Login fehlgeschlagen: ${JSON.stringify(pw.body)}`);
  await ctx.prisma.user.update({ where: { id: account.userId }, data: { totpLastStep: null } });
  const res = await client.post('/auth/2fa', { code: totpAt(account.secret, Date.now()) });
  if (res.status !== 200) throw new Error(`2FA fehlgeschlagen: ${JSON.stringify(res.body)}`);
  return client;
}
