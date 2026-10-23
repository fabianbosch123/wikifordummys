import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { parseSmtpUrl } from '../src/mail/mail.service';
import { Account, createUser, resetState, startApp, TestContext } from './helpers';

let ctx: TestContext;
let admin: Account;

/** Kleiner SMTP-Server für die Tests: Anmeldung nur mit wiki/geheim, Mails landen in received */
const received: { from: string; to: string[]; body: string }[] = [];
const smtp = new SMTPServer({
  authOptional: false,
  disabledCommands: ['STARTTLS'],
  allowInsecureAuth: true,
  logger: false,
  onAuth(auth, _session, cb) {
    if (auth.username === 'wiki' && auth.password === 'geheim') cb(null, { user: auth.username });
    else cb(Object.assign(new Error('Invalid username or password'), { responseCode: 535 }));
  },
  onData(stream, session, cb) {
    let body = '';
    stream.on('data', (c: Buffer) => (body += c.toString()));
    stream.on('end', () => {
      received.push({
        from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
        to: session.envelope.rcptTo.map((r) => r.address),
        body,
      });
      cb();
    });
  },
});
let smtpPort = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  smtpPort = (smtp.server.address() as AddressInfo).port;
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
  await new Promise<void>((resolve) => smtp.close(resolve));
});

beforeEach(async () => {
  await resetState(ctx);
  received.length = 0;
  admin = await createUser(ctx, 'admin@example.de', { admin: true });
});

const valid = () => ({
  host: '127.0.0.1',
  port: smtpPort,
  security: 'none',
  username: 'wiki',
  password: 'geheim',
  from: 'Unser Wiki <wiki@example.de>',
});

describe('SMTP_URL aus .env', () => {
  it('erkennt Verschlüsselung, Port und kodierte Zugangsdaten', () => {
    expect(parseSmtpUrl('smtps://user%40example.de:p%40ss%3Aw@mail.example.de', 'x@example.de')).toEqual({
      host: 'mail.example.de',
      port: 465,
      security: 'tls',
      username: 'user@example.de',
      password: 'p@ss:w',
      from: 'x@example.de',
    });
    expect(parseSmtpUrl('smtp://mail.example.de:2525', 'x@example.de')).toMatchObject({ port: 2525, security: 'starttls', username: '' });
    expect(parseSmtpUrl('smtp://localhost:1025?tls=off', 'x@example.de')).toMatchObject({ security: 'none' });
    expect(() => parseSmtpUrl('http://mail.example.de', 'x')).toThrow(/smtp/);
  });
});

describe('Mail-Einstellungen in der Administration', () => {
  it('sind nur für Systemadministratoren zugänglich', async () => {
    const user = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    expect((await user.client.get('/admin/settings/mail')).status).toBe(403);
    expect((await user.client.put('/admin/settings/mail', valid())).status).toBe(403);
    expect((await user.client.post('/admin/settings/mail/test', {})).status).toBe(403);
    expect((await user.client.delete('/admin/settings/mail')).status).toBe(403);
  });

  it('zeigt ohne SMTP den Stand "nicht eingerichtet"', async () => {
    const res = await admin.client.get('/admin/settings/mail').expect(200);
    expect(res.body).toMatchObject({ source: 'none', envConfigured: false, hasPassword: false });
  });

  it('prüft die Anmeldung vor dem Speichern und speichert nichts bei Fehlern', async () => {
    const res = await admin.client.put('/admin/settings/mail', { ...valid(), password: 'falsch' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SMTP_FAILED');
    expect(res.body.error.message).toMatch(/Anmeldung am Mailserver abgelehnt/);
    expect((await admin.client.get('/admin/settings/mail')).body.source).toBe('none');
  });

  it('meldet einen nicht erreichbaren Server verständlich', async () => {
    const res = await admin.client.put('/admin/settings/mail', { ...valid(), port: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Verbindung/);
  });

  it('speichert gültige Einstellungen verschlüsselt und verschickt danach Mails darüber', async () => {
    const res = await admin.client.put('/admin/settings/mail', valid()).expect(200);
    expect(res.body).toMatchObject({ source: 'admin', host: '127.0.0.1', username: 'wiki', hasPassword: true });
    expect(res.body).not.toHaveProperty('password');

    // Das Passwort steht nicht im Klartext in der Datenbank
    const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'mail' } });
    expect(JSON.stringify(row.value)).not.toContain('geheim');
    expect(ctx.mail.configured).toBe(true);

    // Testmail an die eigene Adresse
    const test = await admin.client.post('/admin/settings/mail/test', {});
    expect(test.status).toBe(200);
    expect(test.body).toEqual({ sent: true, to: 'admin@example.de' });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ from: 'wiki@example.de', to: ['admin@example.de'] });
    expect(received[0].body).toContain('Testmail von wikifordummys');

    // Ohne Passwort im Formular bleibt das bisherige erhalten
    await admin.client.put('/admin/settings/mail', { ...valid(), password: undefined, from: 'neu@example.de' }).expect(200);
    expect((await admin.client.post('/admin/settings/mail/test', { to: 'Jemand@Example.de' })).status).toBe(200);
    expect(received[1]).toMatchObject({ from: 'neu@example.de', to: ['jemand@example.de'] });

    // Audit-Log ohne Passwort
    const entries = await ctx.prisma.auditLog.findMany({ where: { action: { startsWith: 'admin.settings.mail' } } });
    expect(entries.map((e) => e.action).sort()).toEqual([
      'admin.settings.mail.tested',
      'admin.settings.mail.tested',
      'admin.settings.mail.updated',
      'admin.settings.mail.updated',
    ]);
    expect(JSON.stringify(entries)).not.toContain('geheim');
  });

  it('meldet eine fehlgeschlagene Testmail und protokolliert sie', async () => {
    await admin.client.put('/admin/settings/mail', { ...valid(), port: 1, skipVerify: true }).expect(200);
    const res = await admin.client.post('/admin/settings/mail/test', {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SMTP_FAILED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.settings.mail.test_failed' } })).toBe(1);
  });

  it('lehnt ungültige Eingaben ab, auch Zeilenumbrüche im Absender', async () => {
    for (const body of [
      { ...valid(), host: 'mail.example.de; rm -rf' },
      { ...valid(), port: 70000 },
      { ...valid(), security: 'ssl' },
      { ...valid(), from: 'Wiki <wiki@example.de>\r\nBcc: alle@example.de' },
      { ...valid(), from: 'kein-absender' },
      { ...valid(), extra: 1 },
    ]) {
      expect((await admin.client.put('/admin/settings/mail', body)).status).toBe(400);
    }
  });

  it('schaltet auf .env zurück', async () => {
    await admin.client.put('/admin/settings/mail', valid()).expect(200);
    const res = await admin.client.delete('/admin/settings/mail').expect(200);
    expect(res.body.source).toBe('none');
    expect(ctx.mail.configured).toBe(false);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.settings.mail.reset' } })).toBe(1);
  });

  it('gibt Einladungslinks nur ohne Mailversand in der Oberfläche aus', async () => {
    await admin.client.put('/admin/settings/mail', valid()).expect(200);
    const res = await admin.client.post('/admin/users', { email: 'neu@example.de', displayName: 'Neu' });
    expect(res.status).toBe(201);
    expect(res.body.inviteUrl).toBeNull();
  });
});
