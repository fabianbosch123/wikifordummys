import type { PageDto, SpaceDto, TreeNodeDto } from '@wiki/shared';
import { Account, Client, createUser, resetState, startApp, TestContext } from './helpers';
import { createPage, createSpace, doc, PNG } from './fixtures';

let ctx: TestContext;
let admin: Account;
let anna: Account;
let bernd: Account;
let carla: Account;

beforeAll(async () => {
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await resetState(ctx);
  admin = await createUser(ctx, 'admin@example.de', { admin: true });
  anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
  bernd = await createUser(ctx, 'bernd@example.de', { ip: '10.0.0.6' });
  carla = await createUser(ctx, 'carla@example.de', { ip: '10.0.0.7' });
});

const user = (a: Account) => ({ type: 'user' as const, id: a.userId });

async function setRoles(client: Client, key: string, entries: { type: 'user' | 'group'; id: string; role: string }[]) {
  return client.put(`/spaces/${key}/permissions`, { entries });
}

async function groupId(name: string) {
  return (await ctx.prisma.group.findUniqueOrThrow({ where: { name } })).id;
}

async function treeTitles(client: Client, key: string) {
  const res = await client.get(`/spaces/${key}/tree`);
  expect(res.status).toBe(200);
  return (res.body as TreeNodeDto[]).map((n) => n.title).sort();
}

describe('Rollen im Space', () => {
  it('ein privater Space ist für andere unsichtbar, bis sie eine Rolle bekommen', async () => {
    const space = await createSpace(anna.client, 'IT', 'IT-Team', { open: false });
    expect((await bernd.client.get('/spaces')).body).toEqual([]);
    expect((await bernd.client.get('/spaces/IT')).status).toBe(404);
    expect((await bernd.client.get('/spaces/IT/tree')).status).toBe(404);
    expect((await bernd.client.get(`/pages/${space.homePageId}`)).status).toBe(404);

    const perms = await anna.client.get('/spaces/IT/permissions');
    expect(perms.body).toEqual([{ subject: { type: 'user', id: anna.userId, name: 'anna' }, role: 'admin' }]);

    const res = await setRoles(anna.client, 'IT', [
      { ...user(anna), role: 'admin' },
      { ...user(bernd), role: 'viewer' },
    ]);
    expect(res.status).toBe(200);
    const list = (await bernd.client.get('/spaces')).body as SpaceDto[];
    expect(list).toMatchObject([{ key: 'IT', role: 'viewer', canEdit: false }]);
    expect((await bernd.client.get(`/pages/${space.homePageId}`)).body).toMatchObject({ canEdit: false, canRestrict: false, canDelete: false });
    expect((await bernd.client.post('/pages', { spaceKey: 'IT', title: 'X', content: doc('x') })).status).toBe(403);
    expect((await carla.client.get('/spaces/IT')).status).toBe(404);

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'space.permissions_changed' } });
    expect(audit).toMatchObject({ actorId: anna.userId, targetId: space.id });
    expect(audit!.details).toMatchObject({ after: ['user:anna=admin', 'user:bernd=viewer'] });
  });

  it('Rollen gelten auch über Gruppen; die höchste Rolle zählt', async () => {
    await createSpace(anna.client, 'IT', 'IT-Team', { open: false });
    const team = await admin.client.post('/admin/groups', { name: 'team-it', description: '' });
    expect(team.status).toBe(201);
    await admin.client.put(`/admin/groups/${team.body.id}/members`, { userIds: [bernd.userId, carla.userId] });

    await setRoles(anna.client, 'IT', [
      { ...user(anna), role: 'admin' },
      { ...user(bernd), role: 'viewer' },
      { type: 'group', id: team.body.id, role: 'editor' },
    ]).then((r) => expect(r.status).toBe(200));
    // Rollen werden bei jeder Anfrage neu ermittelt; keine neue Anmeldung nötig
    expect((await bernd.client.get('/spaces/IT')).body).toMatchObject({ role: 'editor', canEdit: true });
    expect((await carla.client.post('/pages', { spaceKey: 'IT', title: 'Von Carla', content: doc('x') })).status).toBe(201);

    // alle-benutzer gilt für jedes aktive Konto
    const allUsers = await groupId('alle-benutzer');
    await setRoles(anna.client, 'IT', [
      { ...user(anna), role: 'admin' },
      { type: 'group', id: allUsers, role: 'viewer' },
    ]);
    expect((await carla.client.get('/spaces/IT')).body).toMatchObject({ role: 'viewer' });
    expect((await bernd.client.get('/spaces/IT/permissions')).status).toBe(403);
  });

  it('prüft die Rollenliste: ein Admin bleibt, keine Doppelten, keine Unbekannten, kein Selbstaussperren', async () => {
    await createSpace(anna.client, 'IT', 'IT-Team', { open: false });
    const missing = '00000000-0000-4000-8000-000000000000';
    const cases: [object[], number][] = [
      [[{ ...user(anna), role: 'editor' }], 400],
      [[{ ...user(anna), role: 'admin' }, { ...user(anna), role: 'viewer' }], 400],
      [[{ ...user(anna), role: 'admin' }, { type: 'group', id: missing, role: 'viewer' }], 400],
      [[{ ...user(anna), role: 'admin' }, { type: 'user', id: missing, role: 'viewer' }], 400],
      [[{ ...user(anna), role: 'owner' }], 400],
      [[{ ...user(anna), role: 'admin', extra: 1 }], 400],
      [[{ ...user(bernd), role: 'admin' }, { ...user(anna), role: 'editor' }], 400],
    ];
    for (const [entries, status] of cases) {
      const res = await anna.client.put('/spaces/IT/permissions', { entries });
      expect([entries, res.status]).toEqual([entries, status]);
    }
    expect((await anna.client.put('/spaces/IT/permissions', {})).status).toBe(400);

    // Ein Systemadmin darf Rollen frei vergeben, auch anna die Admin-Rolle nehmen
    const res = await setRoles(admin.client, 'IT', [{ ...user(bernd), role: 'admin' }]);
    expect(res.status).toBe(200);
    expect((await anna.client.get('/spaces/IT')).status).toBe(404);
    expect((await bernd.client.get('/spaces/IT')).body).toMatchObject({ role: 'admin' });
  });

  it('Systemadmins sind in jedem Space Admin', async () => {
    await createSpace(anna.client, 'IT', 'IT-Team', { open: false });
    expect((await admin.client.get('/spaces')).body).toMatchObject([{ key: 'IT', role: 'admin' }]);
    expect((await admin.client.get('/spaces/IT/permissions')).status).toBe(200);
  });
});

describe('Seiteneinschränkungen', () => {
  async function setup() {
    const space = await createSpace(anna.client); // offen: alle Benutzer sind Bearbeiter
    const secret = await createPage(anna.client, 'IT', 'Geheim');
    const child = await createPage(anna.client, 'IT', 'Geheim-Kind', secret.id);
    const open = await createPage(anna.client, 'IT', 'Offen');
    return { space, secret, child, open };
  }

  it('Ansehen-Einschränkung verbirgt Seite und Unterseiten (404, Baum)', async () => {
    const { secret, child } = await setup();
    const res = await anna.client.put(`/pages/${secret.id}/restrictions`, { view: [user(carla)], edit: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ view: [{ type: 'user', id: carla.userId, name: 'carla' }], edit: [], inherited: [] });

    for (const id of [secret.id, child.id]) {
      expect((await bernd.client.get(`/pages/${id}`)).status).toBe(404);
      expect((await bernd.client.get(`/pages/${id}/versions`)).status).toBe(404);
      expect((await bernd.client.get(`/pages/${id}/restrictions`)).status).toBe(404);
      expect((await bernd.client.get(`/pages/${id}/attachments`)).status).toBe(404);
    }
    expect(await treeTitles(bernd.client, 'IT')).toEqual(['IT-Team', 'Offen']);
    expect(await treeTitles(carla.client, 'IT')).toEqual(['Geheim', 'Geheim-Kind', 'IT-Team', 'Offen']);
    // Space-Admins und Systemadmins sind nicht eingeschränkt
    expect(await treeTitles(anna.client, 'IT')).toHaveLength(4);
    expect(await treeTitles(admin.client, 'IT')).toHaveLength(4);

    const forCarla = (await carla.client.get(`/pages/${child.id}`)).body as PageDto;
    expect(forCarla).toMatchObject({ restricted: { view: true, edit: false }, canEdit: true });
    const inherited = await carla.client.get(`/pages/${child.id}/restrictions`);
    expect(inherited.body).toMatchObject({ view: [], edit: [], inherited: [{ pageId: secret.id, title: 'Geheim', type: 'view' }] });

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'page.restrictions_changed' } });
    expect(audit).toMatchObject({ actorId: anna.userId, targetId: secret.id });
  });

  it('Einschränkungen über Gruppen; Einschränkungen von Vorfahren gelten zusätzlich', async () => {
    const { secret, child } = await setup();
    const team = await admin.client.post('/admin/groups', { name: 'team-it', description: '' });
    await admin.client.put(`/admin/groups/${team.body.id}/members`, { userIds: [bernd.userId, carla.userId] });
    await anna.client.put(`/pages/${secret.id}/restrictions`, { view: [{ type: 'group', id: team.body.id }], edit: [] }).then((r) => expect(r.status).toBe(200));
    expect((await bernd.client.get(`/pages/${child.id}`)).status).toBe(200);
    // Die Unterseite verengt weiter: nur carla
    await anna.client.put(`/pages/${child.id}/restrictions`, { view: [user(carla)], edit: [] });
    expect((await bernd.client.get(`/pages/${secret.id}`)).status).toBe(200);
    expect((await bernd.client.get(`/pages/${child.id}`)).status).toBe(404);
    expect((await carla.client.get(`/pages/${child.id}`)).status).toBe(200);
    // Eine Einschränkung auf der Unterseite erweitert nicht: wer oben fehlt, bleibt draußen
    await anna.client.put(`/pages/${child.id}/restrictions`, { view: [user(carla), user(anna), { type: 'group', id: await groupId('alle-benutzer') }], edit: [] });
    await admin.client.put(`/admin/groups/${team.body.id}/members`, { userIds: [carla.userId] });
    expect((await bernd.client.get(`/pages/${child.id}`)).status).toBe(404);
  });

  it('Bearbeiten-Einschränkung: lesen ja, ändern, verschieben und Unterseiten anlegen nein', async () => {
    const { secret, open } = await setup();
    await anna.client.put(`/pages/${secret.id}/restrictions`, { view: [], edit: [user(carla)] }).then((r) => expect(r.status).toBe(200));
    const page = await bernd.client.get(`/pages/${secret.id}`);
    expect(page.body).toMatchObject({ canEdit: false, canRestrict: false, restricted: { view: false, edit: true } });
    expect((await bernd.client.put(`/pages/${secret.id}`, { title: 'X', content: doc('x'), version: 1 })).status).toBe(403);
    expect((await bernd.client.post(`/pages/${secret.id}/move`, { parentId: null, position: 0 })).status).toBe(403);
    expect((await bernd.client.post('/pages', { spaceKey: 'IT', title: 'Kind', parentId: secret.id, content: doc('x') })).status).toBe(403);
    expect((await bernd.client.post(`/pages/${open.id}/move`, { parentId: secret.id, position: 0 })).status).toBe(403);
    expect((await bernd.client.put(`/pages/${secret.id}/restrictions`, { view: [], edit: [] })).status).toBe(403);
    expect((await bernd.client.upload(secret.id, 'a.png', PNG)).status).toBe(403);
    expect((await carla.client.put(`/pages/${secret.id}`, { title: 'Geheim 2', content: doc('x'), version: 1 })).status).toBe(200);
  });

  it('wer nicht Space-Admin ist, kann sich nicht selbst aussperren', async () => {
    const { open } = await setup();
    const lockout = await bernd.client.put(`/pages/${open.id}/restrictions`, { view: [user(carla)], edit: [] });
    expect(lockout.status).toBe(400);
    expect((await bernd.client.put(`/pages/${open.id}/restrictions`, { view: [], edit: [user(carla)] })).status).toBe(400);
    expect((await bernd.client.put(`/pages/${open.id}/restrictions`, { view: [user(bernd), user(carla)], edit: [user(bernd)] })).status).toBe(200);
    expect((await anna.client.put(`/pages/${open.id}/restrictions`, { view: [user(carla)], edit: [] })).status).toBe(200);
  });

  it('unsichtbare Seiten taugen nicht als Elternseite und verraten sich nicht', async () => {
    const { secret, open } = await setup();
    await anna.client.put(`/pages/${secret.id}/restrictions`, { view: [user(anna)], edit: [] });
    const create = await bernd.client.post('/pages', { spaceKey: 'IT', title: 'X', parentId: secret.id, content: doc('x') });
    expect(create.status).toBe(400);
    expect(create.body.error.message).toBe('Die übergeordnete Seite existiert nicht.');
    expect((await bernd.client.post(`/pages/${open.id}/move`, { parentId: secret.id, position: 0 })).status).toBe(400);
  });

  it('prüft Eingaben der Einschränkungen (S9)', async () => {
    const { open } = await setup();
    const missing = '00000000-0000-4000-8000-000000000000';
    for (const body of [
      {},
      { view: [user(anna)] },
      { view: [{ type: 'role', id: anna.userId }], edit: [] },
      { view: [user(anna), user(anna)], edit: [] },
      { view: [{ type: 'user', id: missing }], edit: [] },
      { view: [{ type: 'group', id: 'kein-uuid' }], edit: [] },
    ]) {
      expect([body, (await anna.client.put(`/pages/${open.id}/restrictions`, body)).status]).toEqual([body, 400]);
    }
  });
});

describe('Rechtetest für jede Route (S8)', () => {
  type Route = { method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'upload'; path: string; body?: object; need: 'view' | 'edit' | 'admin' };

  /** Alle Routen, die einen Space oder eine Seite betreffen, mit der mindestens nötigen Rolle */
  function routes(ids: { page: string; deleted: string; attachment: string; userId: string }): Route[] {
    return [
      { method: 'get', path: '/spaces/IT', need: 'view' },
      { method: 'get', path: '/spaces/IT/tree', need: 'view' },
      { method: 'get', path: '/search?q=Inhalt&space=IT', need: 'view' },
      { method: 'get', path: `/pages/${ids.page}`, need: 'view' },
      { method: 'get', path: `/pages/${ids.page}/versions`, need: 'view' },
      { method: 'get', path: `/pages/${ids.page}/versions/1`, need: 'view' },
      { method: 'get', path: `/pages/${ids.page}/diff?from=1&to=1`, need: 'view' },
      { method: 'get', path: `/pages/${ids.page}/restrictions`, need: 'view' },
      { method: 'get', path: `/pages/${ids.page}/attachments`, need: 'view' },
      { method: 'get', path: `/attachments/${ids.attachment}`, need: 'view' },
      { method: 'post', path: '/pages', body: { spaceKey: 'IT', title: 'Neu', content: doc('x') }, need: 'edit' },
      { method: 'put', path: `/pages/${ids.page}`, body: { title: 'Geändert', content: doc('neu'), version: 1 }, need: 'edit' },
      { method: 'post', path: `/pages/${ids.page}/move`, body: { parentId: null, position: 0 }, need: 'edit' },
      { method: 'post', path: `/pages/${ids.page}/restore/1`, need: 'edit' },
      { method: 'put', path: `/pages/${ids.page}/restrictions`, body: { view: [], edit: [] }, need: 'edit' },
      { method: 'upload', path: ids.page, need: 'edit' },
      { method: 'delete', path: `/attachments/${ids.attachment}`, need: 'edit' },
      { method: 'patch', path: '/spaces/IT', body: { description: 'neu' }, need: 'admin' },
      { method: 'get', path: '/spaces/IT/trash', need: 'admin' },
      { method: 'get', path: '/spaces/IT/permissions', need: 'admin' },
      { method: 'post', path: `/pages/${ids.deleted}/undelete`, need: 'admin' },
      { method: 'delete', path: `/pages/${ids.page}`, need: 'admin' },
      // Zuletzt, weil es die eigene Rolle ändern kann
      { method: 'put', path: '/spaces/IT/permissions', body: { entries: [{ type: 'user', id: ids.userId, role: 'admin' }] }, need: 'admin' },
    ];
  }

  function call(client: Client, r: Route) {
    switch (r.method) {
      case 'get':
        return client.get(r.path);
      case 'upload':
        return client.upload(r.path, 'bild.png', PNG);
      case 'post':
        return client.post(r.path, r.body);
      case 'put':
        return client.put(r.path, r.body);
      case 'patch':
        return client.patch(r.path, r.body);
      default:
        return client.delete(r.path);
    }
  }

  async function fixtures() {
    await createSpace(anna.client, 'IT', 'IT-Team', { open: false });
    const page = await createPage(anna.client, 'IT', 'Seite');
    const deleted = await createPage(anna.client, 'IT', 'Alt');
    await anna.client.delete(`/pages/${deleted.id}`).expect(204);
    const attachment = (await anna.client.upload(page.id, 'bild.png', PNG)).body.id as string;
    return { page: page.id, deleted: deleted.id, attachment };
  }

  const RANK = { none: -1, viewer: 0, editor: 1, admin: 2 } as const;
  const NEED = { view: 0, edit: 1, admin: 2 } as const;

  it.each(['none', 'viewer', 'editor', 'admin'] as const)('Rolle %s: ohne Rolle 404, zu niedrige Rolle 403, sonst erlaubt', async (role) => {
    const ids = await fixtures();
    if (role !== 'none') await setRoles(anna.client, 'IT', [{ ...user(anna), role: 'admin' }, { ...user(bernd), role }]);
    for (const route of routes({ ...ids, userId: bernd.userId })) {
      const res = await call(bernd.client, route);
      const expected = role === 'none' ? 404 : RANK[role] < NEED[route.need] ? 403 : 'ok';
      const actual = res.status < 300 ? 'ok' : res.status;
      expect([route.method, route.path, actual]).toEqual([route.method, route.path, expected]);
    }
  });

  it('eine Ansehen-Einschränkung sperrt alle Routen der Seite und ihrer Anhänge (404)', async () => {
    const ids = await fixtures();
    await setRoles(anna.client, 'IT', [{ ...user(anna), role: 'admin' }, { ...user(bernd), role: 'editor' }]);
    await anna.client.put(`/pages/${ids.page}/restrictions`, { view: [user(anna)], edit: [] }).then((r) => expect(r.status).toBe(200));
    const pageRoutes = routes({ ...ids, userId: bernd.userId }).filter(
      (r) => (r.path.includes(ids.page) || r.path.includes(ids.attachment)) && r.need !== 'admin',
    );
    expect(pageRoutes.length).toBeGreaterThan(10);
    for (const route of pageRoutes) {
      const res = await call(bernd.client, route);
      expect([route.method, route.path, res.status]).toEqual([route.method, route.path, 404]);
    }
    const search = await bernd.client.get('/search?q=Seite');
    expect(search.body.results).toEqual([]);
  });

  it('ohne Anmeldung erreicht man keine dieser Routen (401)', async () => {
    const ids = await fixtures();
    const anon = await new Client(ctx, '10.0.9.1').init();
    for (const route of [
      ...routes({ ...ids, userId: anna.userId }),
      { method: 'get', path: '/search?q=x', need: 'view' } as Route,
      { method: 'get', path: '/directory', need: 'view' } as Route,
    ]) {
      const res = await call(anon, route);
      expect([route.path, res.status]).toEqual([route.path, 401]);
    }
  });
});

describe('Verzeichnis für die Rechtevergabe', () => {
  it('liefert aktive Benutzer und Gruppen ohne E-Mail-Adressen', async () => {
    await ctx.prisma.user.update({ where: { id: carla.userId }, data: { status: 'deactivated' } });
    const res = await bernd.client.get('/directory');
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { displayName: string }) => u.displayName)).toEqual(['admin', 'anna', 'bernd']);
    expect(JSON.stringify(res.body)).not.toContain('@example.de');
    expect(res.body.groups.map((g: { name: string }) => g.name)).toEqual(['administratoren', 'alle-benutzer']);
  });
});
