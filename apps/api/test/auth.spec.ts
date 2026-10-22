import { AuthService } from '../src/auth/auth.service';
import { AuditService } from '../src/audit/audit.service';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import {
  Client,
  createUser,
  inviteTokenFromMail,
  login,
  PASSWORD,
  resetState,
  startApp,
  TestContext,
  totpAt,
} from './helpers';

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

function sessionCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return cookies.find((c) => c.startsWith('wiki_session='))?.split(';')[0].split('=')[1];
}

describe('Einladung und Einrichtung der 2FA', () => {
  async function invite(email = 'anna@example.de') {
    const user = await ctx.prisma.user.create({ data: { email, displayName: 'Anna' } });
    await ctx.app.get(AuthService).createInvitation(user, null);
    return { user, token: inviteTokenFromMail(ctx, email) };
  }

  it('zeigt Daten zur Einladung an und lehnt unbekannte Tokens ab', async () => {
    const { token } = await invite();
    const client = await new Client(ctx).init();
    const res = await client.get(`/auth/invite/${token}`).expect(200);
    expect(res.body).toEqual({ email: 'anna@example.de', displayName: 'Anna' });
    await client.get(`/auth/invite/${'x'.repeat(43)}`).expect(400);
  });

  it('verlangt ein Passwort mit mindestens 12 Zeichen (S1)', async () => {
    const { token } = await invite();
    const client = await new Client(ctx).init();
    const res = await client.post('/auth/invite/accept', { token, password: 'zu-kurz' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
  });

  it('gibt ohne eingerichtete 2FA keinen Zugriff auf Inhalte (S2)', async () => {
    const { token, user } = await invite();
    const client = await new Client(ctx).init();
    const accepted = await client.post('/auth/invite/accept', { token, password: PASSWORD });
    expect(accepted.status).toBe(200);
    expect(accepted.body.stage).toBe('totp_setup');

    const me = await client.get('/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('STAGE_REQUIRED');
    expect((await client.get('/auth/session')).body).toMatchObject({ authenticated: false, stage: 'totp_setup' });

    const setup = await client.post('/auth/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    const wrong = await client.post('/auth/2fa/setup/confirm', { code: '000000' === totpAt(setup.body.secret, Date.now()) ? '111111' : '000000' });
    expect(wrong.status).toBe(401);

    const ok = await client.post('/auth/2fa/setup/confirm', { code: totpAt(setup.body.secret, Date.now()) });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    await client.get('/me').expect(200);

    // Geheimnis verschlüsselt, Wiederherstellungscodes nur als Hash gespeichert
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { recoveryCodes: true } });
    expect(stored.totpSecret).not.toContain(setup.body.secret);
    expect(stored.totpSecret?.startsWith('v1.')).toBe(true);
    expect(stored.passwordHash?.startsWith('$argon2id$')).toBe(true);
    const plain = ok.body.recoveryCodes.map((c: string) => c.replace(/-/g, ''));
    for (const rc of stored.recoveryCodes) expect(plain).not.toContain(rc.codeHash);
  });

  it('lässt eine Einladung nur einmal annehmen', async () => {
    const { token } = await invite();
    const client = await new Client(ctx).init();
    expect((await client.post('/auth/invite/accept', { token, password: PASSWORD })).status).toBe(200);
    const again = await (await new Client(ctx).init()).post('/auth/invite/accept', { token, password: PASSWORD });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('lehnt abgelaufene Einladungen ab', async () => {
    const { token, user } = await invite();
    await ctx.prisma.invitation.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await (await new Client(ctx).init()).post('/auth/invite/accept', { token, password: PASSWORD });
    expect(res.status).toBe(400);
  });
});

describe('Login mit Pflicht-2FA', () => {
  it('liefert für unbekannte Adresse und falsches Passwort dieselbe Antwort (S10)', async () => {
    await createUser(ctx, 'anna@example.de');
    const a = await (await new Client(ctx, '10.1.0.1').init()).post('/auth/login', { email: 'anna@example.de', password: 'falsches-passwort-123' });
    const b = await (await new Client(ctx, '10.1.0.2').init()).post('/auth/login', { email: 'niemand@example.de', password: 'falsches-passwort-123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('braucht nach dem Passwort den zweiten Faktor (S2) und erneuert die Session-ID (S4)', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const client = await new Client(ctx).init();
    const pw = await client.post('/auth/login', { email: account.email, password: PASSWORD });
    expect(pw.status).toBe(200);
    expect(pw.body.stage).toBe('password');
    const partialId = sessionCookie(pw);
    expect(partialId).toBeTruthy();

    const me = await client.get('/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('STAGE_REQUIRED');

    await ctx.prisma.user.update({ where: { id: account.userId }, data: { totpLastStep: null } });
    const second = await client.post('/auth/2fa', { code: totpAt(account.secret, Date.now()) });
    expect(second.status).toBe(200);
    const fullId = sessionCookie(second);
    expect(fullId).toBeTruthy();
    expect(fullId).not.toBe(partialId);

    const me2 = await client.get('/me');
    expect(me2.status).toBe(200);
    expect(me2.body.email).toBe('anna@example.de');

    // Die alte Session-ID ist ungültig
    const stale = await ctx.app.getHttpServer();
    const res = await (await import('supertest')).default(stale).get('/api/v1/me').set('Cookie', `wiki_session=${partialId}`);
    expect(res.status).toBe(401);
  });

  it('akzeptiert einen TOTP-Code nur einmal (S2)', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    // Bei der Einrichtung wurde der aktuelle Code bereits verbraucht
    const client = await new Client(ctx).init();
    await client.post('/auth/login', { email: account.email, password: PASSWORD });
    const replay = await client.post('/auth/2fa', { code: totpAt(account.secret, Date.now()) });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_CODE');
  });

  it('akzeptiert jeden Wiederherstellungscode genau einmal (S2)', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const code = account.recoveryCodes[0];

    const c1 = await new Client(ctx).init();
    await c1.post('/auth/login', { email: account.email, password: PASSWORD });
    expect((await c1.post('/auth/2fa', { code })).status).toBe(200);

    const c2 = await new Client(ctx).init();
    await c2.post('/auth/login', { email: account.email, password: PASSWORD });
    expect((await c2.post('/auth/2fa', { code })).status).toBe(401);
  });

  it('lässt deaktivierte Konten nicht anmelden', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    await ctx.prisma.user.update({ where: { id: account.userId }, data: { status: 'deactivated' } });
    const res = await (await new Client(ctx).init()).post('/auth/login', { email: account.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    // Bestehende Sitzung ist ebenfalls ungültig
    expect((await account.client.get('/me')).status).toBe(401);
  });

  it('beendet die Sitzung beim Abmelden', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    expect((await account.client.post('/auth/logout')).status).toBe(204);
    expect((await account.client.get('/me')).status).toBe(401);
  });
});

describe('Rate-Limiting (S3)', () => {
  it('erlaubt höchstens 5 Login-Versuche pro Minute und Konto', async () => {
    await createUser(ctx, 'anna@example.de');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const client = await new Client(ctx, `10.2.0.${i}`).init();
      statuses.push((await client.post('/auth/login', { email: 'anna@example.de', password: 'falsch-falsch-falsch' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('erlaubt höchstens 5 Login-Versuche pro Minute und IP', async () => {
    const client = await new Client(ctx, '10.3.0.1').init();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await client.post('/auth/login', { email: `user${i}@example.de`, password: 'falsch-falsch-falsch' })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('sperrt ein Konto nach 5 Fehlversuchen mit steigender Dauer, auch bei richtigem Passwort', async () => {
    await createUser(ctx, 'anna@example.de');
    for (let i = 0; i < 5; i++) {
      await (await new Client(ctx, `10.4.0.${i}`).init()).post('/auth/login', { email: 'anna@example.de', password: 'falsch-falsch-falsch' });
    }
    // Zeitfenster der Minute ablaufen lassen, die Sperre bleibt
    const keys = await ctx.redis.keys('rl:*');
    if (keys.length) await ctx.redis.del(...keys);

    const res = await (await new Client(ctx, '10.4.1.1').init()).post('/auth/login', { email: 'anna@example.de', password: PASSWORD });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);

    // Ein weiterer Fehlversuch verdoppelt die Sperre
    await ctx.redis.del(...(await ctx.redis.keys('lock:*')));
    await (await new Client(ctx, '10.4.1.2').init()).post('/auth/login', { email: 'anna@example.de', password: 'falsch-falsch-falsch' });
    const lockKey = (await ctx.redis.keys('lock:login:*'))[0];
    expect(await ctx.redis.ttl(lockKey)).toBeGreaterThan(60);
  });

  it('sperrt unbekannte Adressen genauso wie bekannte (S10)', async () => {
    for (let i = 0; i < 5; i++) {
      await (await new Client(ctx, `10.5.0.${i}`).init()).post('/auth/login', { email: 'niemand@example.de', password: 'falsch-falsch-falsch' });
    }
    const keys = await ctx.redis.keys('rl:*');
    if (keys.length) await ctx.redis.del(...keys);
    const res = await (await new Client(ctx, '10.5.1.1').init()).post('/auth/login', { email: 'niemand@example.de', password: 'x' });
    expect(res.status).toBe(429);
  });

  it('begrenzt die 2FA-Eingabe auf 5 Versuche pro Minute', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const client = await new Client(ctx).init();
    await client.post('/auth/login', { email: account.email, password: PASSWORD });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await client.post('/auth/2fa', { code: 'aaaa-bbbb-cccc' })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('erlaubt höchstens 3 Passwort-Reset-Anfragen pro Stunde', async () => {
    const client = await new Client(ctx).init();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await client.post('/auth/password/forgot', { email: 'anna@example.de' })).status);
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it('begrenzt die API allgemein je Benutzer', async () => {
    const app = await createApp({ ...loadConfig(), RATE_API_PER_MINUTE: 5 });
    await app.init();
    try {
      const request = (await import('supertest')).default;
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) statuses.push((await request(app.getHttpServer()).get('/api/v1/health').set('X-Forwarded-For', '10.6.0.1')).status);
      expect(statuses.filter((s) => s === 429).length).toBe(2);
    } finally {
      await app.close();
    }
  });
});

describe('Sitzungen (S4)', () => {
  it('setzt mit HTTPS ein __Host-Cookie mit HttpOnly, Secure und SameSite=Lax', async () => {
    const app = await createApp({ ...loadConfig(), COOKIE_SECURE: true });
    await app.init();
    try {
      await createUser(ctx, 'anna@example.de');
      const request = (await import('supertest')).default;
      const csrf = await request(app.getHttpServer()).get('/api/v1/auth/csrf');
      const csrfCookie = (csrf.headers['set-cookie'] as unknown as string[])[0];
      expect(csrfCookie).toMatch(/^__Host-csrf=.+; Path=\/; Secure; SameSite=Lax$/);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Cookie', csrfCookie.split(';')[0])
        .set('X-CSRF-Token', csrf.body.csrfToken)
        .set('Origin', 'http://wiki.test')
        .set('X-Forwarded-For', '10.7.0.1')
        .send({ email: 'anna@example.de', password: PASSWORD });
      expect(res.status).toBe(200);
      const session = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('__Host-session='));
      expect(session).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    } finally {
      await app.close();
    }
  });

  it('nutzt 12 h Leerlauf-Timeout und 15 min für halbe Anmeldungen', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const partial = await new Client(ctx).init();
    await partial.post('/auth/login', { email: account.email, password: PASSWORD });

    const ttls = await Promise.all((await ctx.redis.keys('sess:*')).map((k) => ctx.redis.ttl(k)));
    expect(Math.max(...ttls)).toBeLessThanOrEqual(12 * 3600);
    expect(Math.max(...ttls)).toBeGreaterThan(12 * 3600 - 60);
    expect(Math.min(...ttls)).toBeLessThanOrEqual(15 * 60);
  });

  it('beendet Sitzungen nach 14 Tagen absolut', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const [key] = await ctx.redis.keys('sess:*');
    const stored = JSON.parse((await ctx.redis.get(key))!);
    stored.createdAt = Date.now() - 14 * 24 * 3600 * 1000 - 1000;
    await ctx.redis.set(key, JSON.stringify(stored), 'EX', 3600);
    expect((await account.client.get('/me')).status).toBe(401);
  });

  it('beendet bei Passwortänderung alle anderen Sitzungen', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const other = await login(ctx, account);
    await other.get('/me').expect(200);

    const res = await account.client.post('/me/password', { currentPassword: PASSWORD, newPassword: 'ein-ganz-neues-passwort' });
    expect(res.status).toBe(204);
    await account.client.get('/me').expect(200);
    expect((await other.get('/me')).status).toBe(401);
  });

  it('lehnt die Passwortänderung mit falschem aktuellem Passwort ab', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const res = await account.client.post('/me/password', { currentPassword: 'falsch-falsch-falsch', newPassword: 'ein-ganz-neues-passwort' });
    expect(res.status).toBe(400);
  });

  it('listet Sitzungen und meldet einzelne Geräte ab', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const other = await login(ctx, account);
    const list = await account.client.get('/me/sessions').expect(200);
    expect(list.body).toHaveLength(2);
    const foreign = list.body.find((s: { current: boolean }) => !s.current);
    expect(foreign.ip).toBe('10.0.0.2');

    await account.client.delete(`/me/sessions/${foreign.id}`).expect(204);
    expect((await other.get('/me')).status).toBe(401);
  });

  it('kann keine fremden Sitzungen beenden', async () => {
    const anna = await createUser(ctx, 'anna@example.de');
    const bernd = await createUser(ctx, 'bernd@example.de', { ip: '10.0.0.9' });
    const [berndSession] = (await bernd.client.get('/me/sessions')).body;
    expect((await anna.client.delete(`/me/sessions/${berndSession.id}`)).status).toBe(404);
    await bernd.client.get('/me').expect(200);
  });
});

describe('CSRF (S5)', () => {
  it('lehnt ändernde Anfragen ohne Token ab', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const res = await account.client.agent.post('/api/v1/auth/logout').set('Origin', 'http://wiki.test');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('lehnt ein falsches Token ab', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const res = await account.client.agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://wiki.test')
      .set('X-CSRF-Token', 'A'.repeat(43));
    expect(res.status).toBe(403);
  });

  it('lehnt fremde Origin- und Referer-Header ab', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const origin = await account.client.agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://boese.example')
      .set('X-CSRF-Token', account.client.csrf);
    expect(origin.status).toBe(403);
    const referer = await account.client.agent
      .post('/api/v1/auth/logout')
      .set('Referer', 'https://boese.example/seite')
      .set('X-CSRF-Token', account.client.csrf);
    expect(referer.status).toBe(403);
  });

  it('erlaubt die Anfrage mit passendem Token', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    expect((await account.client.post('/auth/logout')).status).toBe(204);
  });
});

describe('Passwort vergessen', () => {
  it('antwortet für bekannte und unbekannte Adressen gleich (S10)', async () => {
    await createUser(ctx, 'anna@example.de');
    ctx.mail.outbox.length = 0;
    const known = await (await new Client(ctx, '10.8.0.1').init()).post('/auth/password/forgot', { email: 'anna@example.de' });
    const unknown = await (await new Client(ctx, '10.8.0.2').init()).post('/auth/password/forgot', { email: 'niemand@example.de' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(ctx.mail.outbox.map((m) => m.to)).toEqual(['anna@example.de']);
  });

  it('setzt das Passwort zurück, beendet alle Sitzungen und verlangt weiter 2FA', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    const client = await new Client(ctx, '10.9.0.1').init();
    await client.post('/auth/password/forgot', { email: account.email });
    const token = ctx.mail.outbox.at(-1)!.text.match(/reset-password\/([A-Za-z0-9_-]+)/)![1];

    expect((await client.post('/auth/password/reset', { token, password: 'kurz' })).status).toBe(400);
    expect((await client.post('/auth/password/reset', { token, password: 'mein-neues-passwort-2026' })).status).toBe(204);
    expect((await client.post('/auth/password/reset', { token, password: 'noch-ein-neues-passwort' })).status).toBe(400);
    expect((await account.client.get('/me')).status).toBe(401);

    const old = await (await new Client(ctx, '10.9.0.2').init()).post('/auth/login', { email: account.email, password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await (await new Client(ctx, '10.9.0.3').init()).post('/auth/login', { email: account.email, password: 'mein-neues-passwort-2026' });
    expect(fresh.status).toBe(200);
    expect(fresh.body.stage).toBe('password');
  });
});

describe('Audit-Log (S12)', () => {
  it('protokolliert Anmeldungen und Fehlversuche mit IP', async () => {
    const account = await createUser(ctx, 'anna@example.de');
    await (await new Client(ctx, '10.10.0.1').init()).post('/auth/login', { email: account.email, password: 'falsch-falsch-falsch' });
    await login(ctx, account, '10.10.0.2');

    const entries = await ctx.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.invite.accepted', 'auth.2fa.setup', 'auth.login.failed', 'auth.login.success']));
    expect(entries.find((e) => e.action === 'auth.login.failed')?.ip).toBe('10.10.0.1');
    // Keine Passwörter im Audit-Log
    expect(JSON.stringify(entries)).not.toContain('falsch-falsch-falsch');
  });

  it('verhindert nachträgliche Änderungen', async () => {
    await ctx.app.get(AuditService).log({ action: 'test.event' });
    await expect(ctx.prisma.auditLog.updateMany({ data: { action: 'manipuliert' } })).rejects.toThrow(/nur anhängbar/);
  });

  it('löscht Einträge nach 365 Tagen', async () => {
    await ctx.prisma.auditLog.create({ data: { action: 'alt', createdAt: new Date(Date.now() - 366 * 24 * 3600 * 1000) } });
    await ctx.prisma.auditLog.create({ data: { action: 'neu' } });
    expect(await ctx.app.get(AuditService).purgeExpired()).toBe(1);
    expect((await ctx.prisma.auditLog.findMany()).map((e) => e.action)).toEqual(['neu']);
  });
});
