import { AuthService } from '../src/auth/auth.service';
import { createAdmin, resetPassword } from '../src/cli';
import { Client, createUser, PASSWORD, resetState, startApp, TestContext, totpAt } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await resetState(ctx);
});

/** Anmeldung mit Startpasswort bis einschließlich 2FA-Einrichtung */
async function loginWithStartPassword(email: string, password: string, ip = '10.0.5.1') {
  const client = await new Client(ctx, ip).init();
  const pw = await client.post('/auth/login', { email, password });
  expect(pw.status).toBe(200);
  expect(pw.body.stage).toBe('totp_setup');
  const setup = await client.post('/auth/2fa/setup');
  const confirm = await client.post('/auth/2fa/setup/confirm', { code: totpAt(setup.body.secret, Date.now()) });
  expect(confirm.status).toBe(200);
  return client;
}

describe('Startpasswort aus der Kommandozeile', () => {
  it('legt einen Admin ohne Mailversand an; bis zum Passwortwechsel ist nur das Profil erreichbar', async () => {
    const result = await createAdmin('Shell@Example.de', 'Shell Admin');
    expect(result.inviteUrl).toBeUndefined();
    expect(result.password).toMatch(/^[a-zA-Z2-9]{5}(-[a-zA-Z2-9]{5}){3}$/);
    expect(ctx.mail.outbox).toHaveLength(0);

    const client = await loginWithStartPassword('shell@example.de', result.password!);
    const session = await client.get('/auth/session');
    expect(session.body.user).toMatchObject({ isAdmin: true, mustChangePassword: true });

    const blocked = await client.get('/admin/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await client.get('/spaces')).status).toBe(403);
    expect((await client.get('/me')).status).toBe(200);

    const same = await client.post('/me/password', { currentPassword: result.password, newPassword: result.password });
    expect(same.body.error.code).toBe('SAME_PASSWORD');
    expect((await client.post('/me/password', { currentPassword: result.password, newPassword: PASSWORD })).status).toBe(204);
    expect((await client.get('/auth/session')).body.user.mustChangePassword).toBe(false);
    expect((await client.get('/admin/users')).status).toBe(200);

    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'cli.password.issued' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(result.password);
  });

  it('mit --invite bleibt es beim Einladungslink', async () => {
    const result = await createAdmin('einladung@example.de', 'Per Mail', { invite: true });
    expect(result.password).toBeUndefined();
    expect(result.inviteUrl).toMatch(/\/invite\//);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'einladung@example.de' } })).status).toBe('invited');
  });

  it('reset-password: neues Startpasswort, alte Sitzungen enden, 2FA bleibt', async () => {
    const anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.5.2' });
    const { password } = await resetPassword('anna@example.de');
    expect((await anna.client.get('/me')).status).toBe(401);

    const client = await new Client(ctx, '10.0.5.3').init();
    expect((await client.post('/auth/login', { email: anna.email, password: PASSWORD })).status).toBe(401);
    const pw = await client.post('/auth/login', { email: anna.email, password });
    expect(pw.body.stage).toBe('password');
    await ctx.prisma.user.update({ where: { id: anna.userId }, data: { totpLastStep: null } });
    expect((await client.post('/auth/2fa', { code: totpAt(anna.secret, Date.now()) })).status).toBe(200);
    expect((await client.get('/pages/x')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('aktiviert ein noch eingeladenes Konto und macht offene Einladungen ungültig', async () => {
    const { inviteUrl } = await createAdmin('wartend@example.de', 'Wartend', { invite: true });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'wartend@example.de' } });
    await ctx.app.get(AuthService).issueStartPassword(user.id);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active');
    const token = inviteUrl!.split('/invite/')[1];
    const anon = await new Client(ctx, '10.0.5.4').init();
    expect((await anon.get(`/auth/invite/${token}`)).status).toBe(400);
  });

  it('verweigert deaktivierte und unbekannte Konten', async () => {
    const bob = await createUser(ctx, 'bob@example.de', { ip: '10.0.5.5' });
    await ctx.prisma.user.update({ where: { id: bob.userId }, data: { status: 'deactivated' } });
    await expect(resetPassword('bob@example.de')).rejects.toThrow(/deaktiviert/);
    await expect(resetPassword('niemand@example.de')).rejects.toThrow(/kein Konto/);
  });
});
