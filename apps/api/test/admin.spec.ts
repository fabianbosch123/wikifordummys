import { Account, Client, createUser, inviteTokenFromMail, login, PASSWORD, resetState, startApp, TestContext } from './helpers';

let ctx: TestContext;
let admin: Account;

beforeAll(async () => {
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await resetState(ctx);
  admin = await createUser(ctx, 'admin@example.de', { admin: true });
});

async function groupId(name: string) {
  return (await ctx.prisma.group.findUniqueOrThrow({ where: { name } })).id;
}

describe('Zugriffsschutz der Admin-Routen', () => {
  it('verweigert normalen Benutzern den Zugriff', async () => {
    const user = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    for (const path of ['/admin/users', '/admin/groups', '/admin/audit']) {
      expect((await user.client.get(path)).status).toBe(403);
    }
    expect((await user.client.post('/admin/users', { email: 'x@example.de', displayName: 'X' })).status).toBe(403);
  });

  it('verweigert Admins ohne abgeschlossene 2FA den Zugriff', async () => {
    const partial = await new Client(ctx, '10.0.0.6').init();
    await partial.post('/auth/login', { email: admin.email, password: PASSWORD });
    expect((await partial.get('/admin/users')).status).toBe(401);
  });

  it('verweigert den Zugriff ohne Anmeldung', async () => {
    const anon = await new Client(ctx, '10.0.0.7').init();
    expect((await anon.get('/admin/users')).status).toBe(401);
  });
});

describe('Benutzerverwaltung', () => {
  it('lädt Benutzer ein; die Einladung führt zum Konto mit Pflicht-2FA', async () => {
    const teamIt = await admin.client.post('/admin/groups', { name: 'team-it', description: 'IT' });
    const res = await admin.client.post('/admin/users', {
      email: 'Neu@Example.de',
      displayName: 'Neue Person',
      groupIds: [teamIt.body.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'neu@example.de', status: 'invited', groupIds: [teamIt.body.id] });
    // Ohne SMTP gibt die API den Link für die manuelle Weitergabe zurück
    expect(res.body.inviteUrl).toMatch(/^http:\/\/wiki\.test\/invite\//);

    const token = inviteTokenFromMail(ctx, 'neu@example.de');
    const client = await new Client(ctx, '10.0.1.1').init();
    const accepted = await client.post('/auth/invite/accept', { token, password: PASSWORD, displayName: 'Neu' });
    expect(accepted.body.stage).toBe('totp_setup');
  });

  it('lehnt doppelte Adressen und unbekannte Felder ab (S9)', async () => {
    expect((await admin.client.post('/admin/users', { email: 'admin@example.de', displayName: 'X' })).status).toBe(409);
    const extra = await admin.client.post('/admin/users', { email: 'y@example.de', displayName: 'Y', status: 'active' });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION');
    expect((await admin.client.post('/admin/users', { email: 'keine-adresse', displayName: 'Y' })).status).toBe(400);
  });

  it('nennt eine offene Einladung beim Namen statt „bereits ein Konto“', async () => {
    const created = await admin.client.post('/admin/users', { email: 'offen@example.de', displayName: 'Offen' });
    expect(created.status).toBe(201);
    const again = await admin.client.post('/admin/users', { email: 'offen@example.de', displayName: 'Offen' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'ALREADY_INVITED', userId: created.body.user.id });
    expect(again.body.error.message).toContain('Einladung offen');
    const active = await admin.client.post('/admin/users', { email: 'admin@example.de', displayName: 'X' });
    expect(active.body.error.code).toBe('CONFLICT');
  });

  it('deaktiviert Konten und beendet deren Sitzungen', async () => {
    const anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    const res = await admin.client.patch(`/admin/users/${anna.userId}`, { status: 'deactivated' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('deactivated');
    expect((await anna.client.get('/me')).status).toBe(401);
    const loginTry = await (await new Client(ctx, '10.0.2.1').init()).post('/auth/login', { email: anna.email, password: PASSWORD });
    expect(loginTry.status).toBe(401);

    expect((await admin.client.patch(`/admin/users/${anna.userId}`, { status: 'active' })).status).toBe(200);
    await login(ctx, anna, '10.0.2.2');
  });

  it('schützt vor Selbstdeaktivierung und Entfernen des letzten Admins', async () => {
    expect((await admin.client.patch(`/admin/users/${admin.userId}`, { status: 'deactivated' })).status).toBe(400);
    const res = await admin.client.patch(`/admin/users/${admin.userId}`, { isAdmin: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_ADMIN');
    const members = await admin.client.put(`/admin/groups/${await groupId('administratoren')}/members`, { userIds: [] });
    expect(members.status).toBe(400);
  });

  it('vergibt Adminrechte und entzieht sie wieder', async () => {
    const anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    expect((await anna.client.get('/admin/users')).status).toBe(403);
    expect((await admin.client.patch(`/admin/users/${anna.userId}`, { isAdmin: true })).body.isAdmin).toBe(true);
    expect((await anna.client.get('/admin/users')).status).toBe(200);
    expect((await admin.client.patch(`/admin/users/${anna.userId}`, { isAdmin: false })).body.isAdmin).toBe(false);
    expect((await anna.client.get('/admin/users')).status).toBe(403);
  });

  it('setzt die 2FA zurück; beim nächsten Login muss sie neu eingerichtet werden', async () => {
    const anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    expect((await admin.client.post(`/admin/users/${anna.userId}/reset-2fa`)).status).toBe(204);
    expect((await anna.client.get('/me')).status).toBe(401);
    const res = await (await new Client(ctx, '10.0.3.1').init()).post('/auth/login', { email: anna.email, password: PASSWORD });
    expect(res.body.stage).toBe('totp_setup');
    expect(await ctx.prisma.recoveryCode.count({ where: { userId: anna.userId } })).toBe(0);
  });

  it('beendet alle Sitzungen eines Benutzers', async () => {
    const anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    expect((await admin.client.delete(`/admin/users/${anna.userId}/sessions`)).status).toBe(204);
    expect((await anna.client.get('/me')).status).toBe(401);
  });

  it('verschickt Einladungen erneut und macht alte Links ungültig', async () => {
    const created = await admin.client.post('/admin/users', { email: 'neu@example.de', displayName: 'Neu' });
    const first = inviteTokenFromMail(ctx, 'neu@example.de');
    expect((await admin.client.post(`/admin/users/${created.body.user.id}/invite`)).status).toBe(200);
    const second = inviteTokenFromMail(ctx, 'neu@example.de');
    expect(second).not.toBe(first);
    const client = await new Client(ctx, '10.0.4.1').init();
    expect((await client.post('/auth/invite/accept', { token: first, password: PASSWORD })).status).toBe(400);
    expect((await client.post('/auth/invite/accept', { token: second, password: PASSWORD })).status).toBe(200);
  });

  it('liefert 400 für ungültige und 404 für unbekannte IDs', async () => {
    expect((await admin.client.patch('/admin/users/keine-uuid', { displayName: 'X' })).status).toBe(400);
    expect((await admin.client.patch('/admin/users/00000000-0000-4000-8000-000000000000', { displayName: 'X' })).status).toBe(404);
  });
});

describe('Gruppenverwaltung', () => {
  it('legt Gruppen an, setzt Mitglieder und löscht sie', async () => {
    const anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    const created = await admin.client.post('/admin/groups', { name: 'Team-IT', description: 'Die IT' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('team-it');

    expect((await admin.client.put(`/admin/groups/${created.body.id}/members`, { userIds: [anna.userId] })).status).toBe(204);
    const groups = (await admin.client.get('/admin/groups')).body;
    expect(groups.find((g: { name: string }) => g.name === 'team-it').memberIds).toEqual([anna.userId]);

    expect((await admin.client.post('/admin/groups', { name: 'team-it' })).status).toBe(409);
    expect((await admin.client.post('/admin/groups', { name: 'ungültig name!' })).status).toBe(400);
    expect((await admin.client.delete(`/admin/groups/${created.body.id}`)).status).toBe(204);
  });

  it('schützt Systemgruppen', async () => {
    expect((await admin.client.delete(`/admin/groups/${await groupId('administratoren')}`)).status).toBe(400);
    expect((await admin.client.delete(`/admin/groups/${await groupId('alle-benutzer')}`)).status).toBe(400);
    expect((await admin.client.put(`/admin/groups/${await groupId('alle-benutzer')}/members`, { userIds: [] })).status).toBe(400);
  });
});

describe('Audit-Log in der Admin-Ansicht (S12)', () => {
  it('zeigt Admin-Aktionen und Rechteänderungen und lässt sich filtern', async () => {
    const anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
    await admin.client.patch(`/admin/users/${anna.userId}`, { isAdmin: true });
    await admin.client.patch(`/admin/users/${anna.userId}`, { status: 'deactivated' });
    await admin.client.post('/admin/groups', { name: 'team-hr' });

    const all = (await admin.client.get('/admin/audit')).body as { action: string; actorEmail: string }[];
    const actions = all.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['admin.permission.changed', 'admin.user.deactivated', 'admin.group.created', 'auth.login.success']),
    );
    expect(all.find((e) => e.action === 'admin.group.created')?.actorEmail).toBe('admin@example.de');

    const filtered = (await admin.client.get('/admin/audit?action=admin.group')).body as { action: string }[];
    expect(filtered.every((e) => e.action.startsWith('admin.group'))).toBe(true);
    expect((await admin.client.get('/admin/audit?limit=9999')).status).toBe(400);
  });
});
