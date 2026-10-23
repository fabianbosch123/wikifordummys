import type { DocNode, PageDto, TreeNodeDto } from '@wiki/shared';
import { PagesService } from '../src/pages/pages.service';
import { Account, Client, createUser, login, PASSWORD, resetState, startApp, TestContext } from './helpers';

let ctx: TestContext;
let admin: Account;
let anna: Account;
let bernd: Account;

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
});

const doc = (text: string): DocNode => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function createSpace(client: Client, key = 'IT', name = 'IT-Team') {
  const res = await client.post('/spaces', { key, name, description: 'Wissen der IT' });
  expect(res.status).toBe(201);
  return res.body as { id: string; key: string; homePageId: string };
}

async function createPage(client: Client, spaceKey: string, title: string, parentId?: string): Promise<PageDto> {
  const res = await client.post('/pages', { spaceKey, title, parentId, content: doc(`Inhalt von ${title}`) });
  if (res.status !== 201) throw new Error(`Seite anlegen: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function tree(client: Client, key: string): Promise<TreeNodeDto[]> {
  const res = await client.get(`/spaces/${key}/tree`);
  expect(res.status).toBe(200);
  return res.body;
}

/** Titel der Kinder einer Seite in Baumreihenfolge */
async function childTitles(client: Client, key: string, parentId: string | null) {
  return (await tree(client, key))
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.position - b.position)
    .map((n) => n.title);
}

describe('Spaces', () => {
  it('legt einen Space mit Startseite an; der Schlüssel wird groß geschrieben', async () => {
    const space = await createSpace(anna.client, 'it');
    expect(space).toMatchObject({ key: 'IT', name: 'IT-Team', status: 'active', role: 'admin', canEdit: true });
    const home = await anna.client.get(`/pages/${space.homePageId}`);
    expect(home.body).toMatchObject({ title: 'IT-Team', isHome: true, version: 1, canDelete: false, spaceKey: 'IT' });
    expect(home.body.content).toEqual(doc('Wissen der IT'));

    const list = await bernd.client.get('/spaces');
    expect(list.body.map((s: { key: string }) => s.key)).toEqual(['IT']);
    expect(list.body[0]).toMatchObject({ role: 'editor', canEdit: true, createdBy: { displayName: 'anna' } });

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'space.created' } });
    expect(audit).toMatchObject({ actorId: anna.userId, targetId: space.id });
  });

  it('lehnt doppelte und ungültige Schlüssel ab (S9)', async () => {
    await createSpace(anna.client);
    expect((await bernd.client.post('/spaces', { key: 'IT', name: 'Doppelt' })).status).toBe(409);
    for (const key of ['1A', 'A', 'ABCDEFGHIJK', 'A-B', 'ÄB']) {
      const res = await anna.client.post('/spaces', { key, name: 'X' });
      expect(res.status).toBe(400);
    }
    expect((await anna.client.post('/spaces', { key: 'HR', name: 'HR', status: 'archived' })).status).toBe(400);
    expect((await anna.client.post('/spaces', { key: 'HR', name: 'Zeile\nUmbruch' })).status).toBe(400);
  });

  it('nur wer create_space hat, darf Spaces anlegen', async () => {
    const allUsers = await ctx.prisma.group.findUniqueOrThrow({ where: { name: 'alle-benutzer' } });
    await ctx.prisma.globalPermission.delete({ where: { groupId_permission: { groupId: allUsers.id, permission: 'create_space' } } });
    try {
      const relogged = await login(ctx, anna, '10.0.3.1');
      expect((await relogged.get('/me')).body.canCreateSpace).toBe(false);
      expect((await relogged.post('/spaces', { key: 'HR', name: 'HR' })).status).toBe(403);
      // Systemadmins dürfen immer
      expect((await admin.client.post('/spaces', { key: 'HR', name: 'HR' })).status).toBe(201);
    } finally {
      await ctx.prisma.globalPermission.create({ data: { groupId: allUsers.id, permission: 'create_space' } });
    }
  });

  it('nur Space-Admins ändern Einstellungen; archivierte Spaces sind schreibgeschützt', async () => {
    const space = await createSpace(anna.client);
    expect((await bernd.client.patch('/spaces/IT', { name: 'Gekapert' })).status).toBe(403);
    expect((await admin.client.patch('/spaces/IT', { description: 'Neu' })).status).toBe(200);

    const page = await createPage(bernd.client, 'IT', 'Anleitung');
    const archived = await anna.client.patch('/spaces/it', { status: 'archived' });
    expect(archived.body).toMatchObject({ status: 'archived', canEdit: false });

    expect((await bernd.client.get('/spaces')).body).toEqual([]);
    expect((await bernd.client.get('/spaces?status=archived')).body).toHaveLength(1);
    expect((await bernd.client.get(`/pages/${page.id}`)).body.canEdit).toBe(false);

    const save = await bernd.client.put(`/pages/${page.id}`, { title: 'X', content: doc('x'), version: 1 });
    expect(save.status).toBe(403);
    expect(save.body.error.code).toBe('SPACE_ARCHIVED');
    expect((await bernd.client.post('/pages', { spaceKey: 'IT', title: 'Neu', content: doc('x') })).status).toBe(403);
    expect((await anna.client.delete(`/pages/${page.id}`)).status).toBe(403);

    expect((await anna.client.patch('/spaces/IT', { status: 'active' })).status).toBe(200);
    expect((await bernd.client.put(`/pages/${page.id}`, { title: 'X', content: doc('x'), version: 1 })).status).toBe(200);

    const actions = (await ctx.prisma.auditLog.findMany({ where: { targetId: space.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['space.created', 'space.updated', 'space.archived', 'space.unarchived']));
  });

  it('unbekannte Spaces liefern 404', async () => {
    expect((await anna.client.get('/spaces/NOPE')).status).toBe(404);
    expect((await anna.client.get('/spaces/../admin')).status).toBe(404);
    expect((await anna.client.get('/spaces/NOPE/tree')).status).toBe(404);
  });
});

describe('Seiten anlegen und bearbeiten', () => {
  it('legt Seiten im Baum an und liefert Breadcrumbs', async () => {
    const space = await createSpace(anna.client);
    const a = await createPage(bernd.client, 'IT', 'Server', space.homePageId);
    const b = await createPage(bernd.client, 'IT', 'Backup', a.id);
    expect(b.ancestors.map((x) => x.title)).toEqual(['IT-Team', 'Server']);
    expect(b).toMatchObject({ version: 1, canEdit: true, canDelete: false, createdBy: { displayName: 'bernd' } });
    // Bernd ist Bearbeiter, Anna als Erstellerin Space-Admin
    expect((await anna.client.get(`/pages/${b.id}`)).body.canDelete).toBe(true);
    expect(await childTitles(anna.client, 'IT', a.id)).toEqual(['Backup']);
  });

  it('jede Speicherung ist eine Version; veraltete Stände liefern 409 mit dem aktuellen Stand', async () => {
    const space = await createSpace(anna.client);
    const page = await createPage(anna.client, 'IT', 'Notizen', space.homePageId);

    const v2 = await anna.client.put(`/pages/${page.id}`, { title: 'Notizen', content: doc('zweite Fassung'), version: 1 });
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ version: 2, updatedBy: { displayName: 'anna' } });

    const stale = await bernd.client.put(`/pages/${page.id}`, { title: 'Notizen', content: doc('Bernds Fassung'), version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT', current: { version: 2, content: doc('zweite Fassung') } });

    // Unveränderter Inhalt erzeugt keine neue Version
    const same = await anna.client.put(`/pages/${page.id}`, { title: 'Notizen', content: doc('zweite Fassung'), version: 2 });
    expect(same.body.version).toBe(2);
    expect(await ctx.prisma.pageVersion.count({ where: { pageId: page.id } })).toBe(2);
  });

  it('Versionen sind unveränderlich', async () => {
    const space = await createSpace(anna.client);
    await expect(
      ctx.prisma.pageVersion.updateMany({ where: { pageId: space.homePageId }, data: { title: 'gefälscht' } }),
    ).rejects.toThrow(/unveränderlich/);
  });

  it('prüft Inhalte serverseitig (S6) und Eingaben (S9)', async () => {
    const space = await createSpace(anna.client);
    const link = (href: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'klick', marks: [{ type: 'link', attrs: { href } }] }] }],
    });
    const bad = await anna.client.post('/pages', { spaceKey: 'IT', title: 'XSS', content: link('javascript:alert(1)') });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CONTENT');

    const iframe = { type: 'doc', content: [{ type: 'iframe', attrs: { src: 'https://evil.example' } }] };
    expect((await anna.client.post('/pages', { spaceKey: 'IT', title: 'X', content: iframe })).status).toBe(400);

    // Text, der wie HTML aussieht, bleibt Text; unbekannte Attribute entfallen
    const html = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const ok = await anna.client.post('/pages', {
      spaceKey: 'IT',
      title: '<b>Titel</b>',
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'alert(1)' }, content: [{ type: 'text', text: html }] }] },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.title).toBe('<b>Titel</b>');
    expect(ok.body.content).toEqual(doc(html));

    expect((await anna.client.post('/pages', { spaceKey: 'IT', title: '', content: doc('x') })).status).toBe(400);
    expect((await anna.client.post('/pages', { spaceKey: 'IT', title: 'x'.repeat(201), content: doc('x') })).status).toBe(400);
    expect((await anna.client.post('/pages', { spaceKey: 'IT', title: 'X', content: 'text' })).status).toBe(400);
    expect((await anna.client.post('/pages', { spaceKey: 'IT', title: 'X', content: doc('x'), version: 3 })).status).toBe(400);
    expect((await anna.client.put(`/pages/${space.homePageId}`, { title: 'X', content: doc('x') })).status).toBe(400);
  });

  it('Elternseiten aus anderen Spaces oder im Papierkorb werden abgelehnt', async () => {
    const it = await createSpace(anna.client, 'IT');
    const hr = await createSpace(anna.client, 'HR', 'Personal');
    expect((await anna.client.post('/pages', { spaceKey: 'IT', title: 'X', parentId: hr.homePageId, content: doc('x') })).status).toBe(400);
    const child = await createPage(anna.client, 'IT', 'Alt', it.homePageId);
    await anna.client.delete(`/pages/${child.id}`).expect(204);
    expect((await anna.client.post('/pages', { spaceKey: 'IT', title: 'X', parentId: child.id, content: doc('x') })).status).toBe(400);
  });
});

describe('Seitenbaum: verschieben', () => {
  it('sortiert um, hängt um und passt die Pfade aller Unterseiten an', async () => {
    const space = await createSpace(anna.client);
    const home = space.homePageId;
    const a = await createPage(anna.client, 'IT', 'A', home);
    const b = await createPage(anna.client, 'IT', 'B', home);
    const c = await createPage(anna.client, 'IT', 'C', home);
    const a1 = await createPage(anna.client, 'IT', 'A1', a.id);
    const a11 = await createPage(anna.client, 'IT', 'A11', a1.id);

    // Umsortieren unter derselben Elternseite
    expect((await bernd.client.post(`/pages/${c.id}/move`, { parentId: home, position: 0 })).status).toBe(200);
    expect(await childTitles(anna.client, 'IT', home)).toEqual(['C', 'A', 'B']);

    // A1 samt A11 unter B hängen
    const moved = await bernd.client.post(`/pages/${a1.id}/move`, { parentId: b.id, position: 0 });
    expect(moved.body.ancestors.map((x: { title: string }) => x.title)).toEqual(['IT-Team', 'B']);
    const deep = await anna.client.get(`/pages/${a11.id}`);
    expect(deep.body.ancestors.map((x: { title: string }) => x.title)).toEqual(['IT-Team', 'B', 'A1']);
    expect(await childTitles(anna.client, 'IT', a.id)).toEqual([]);

    // Auf die oberste Ebene, Position wird begrenzt
    await bernd.client.post(`/pages/${b.id}/move`, { parentId: null, position: 999 });
    expect(await childTitles(anna.client, 'IT', null)).toEqual(['IT-Team', 'B']);
    expect((await anna.client.get(`/pages/${a11.id}`)).body.ancestors.map((x: { title: string }) => x.title)).toEqual(['B', 'A1']);

    const positions = (await tree(anna.client, 'IT')).filter((n) => n.parentId === home).map((n) => n.position).sort();
    expect(positions).toEqual([0, 1]);
  });

  it('verhindert Zyklen, das Verschieben der Startseite und fremde Spaces', async () => {
    const space = await createSpace(anna.client);
    const hr = await createSpace(anna.client, 'HR', 'Personal');
    const a = await createPage(anna.client, 'IT', 'A', space.homePageId);
    const a1 = await createPage(anna.client, 'IT', 'A1', a.id);
    expect((await anna.client.post(`/pages/${a.id}/move`, { parentId: a1.id, position: 0 })).status).toBe(400);
    expect((await anna.client.post(`/pages/${a.id}/move`, { parentId: a.id, position: 0 })).status).toBe(400);
    expect((await anna.client.post(`/pages/${space.homePageId}/move`, { parentId: a.id, position: 0 })).status).toBe(400);
    expect((await anna.client.post(`/pages/${a.id}/move`, { parentId: hr.homePageId, position: 0 })).status).toBe(400);
    expect((await anna.client.post(`/pages/${a.id}/move`, { position: 0 })).status).toBe(400);
    expect((await anna.client.post(`/pages/${a.id}/move`, { parentId: null, position: -1 })).status).toBe(400);
  });
});

describe('Versionen: Verlauf, Vergleich, Wiederherstellen', () => {
  it('vergleicht Versionen zeilenweise und stellt eine alte Version als neue her', async () => {
    const space = await createSpace(anna.client);
    const page = await createPage(anna.client, 'IT', 'Ablauf', space.homePageId);
    const two: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Inhalt von Ablauf' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Neuer Schritt' }] },
      ],
    };
    await bernd.client.put(`/pages/${page.id}`, { title: 'Ablauf neu', content: two, version: 1 }).expect(200);

    const versions = await anna.client.get(`/pages/${page.id}/versions`);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.body[0]).toMatchObject({ title: 'Ablauf neu', author: { displayName: 'bernd' }, restoredFrom: null });

    const diff = await anna.client.get(`/pages/${page.id}/diff?from=1&to=2`);
    expect(diff.body).toEqual({
      from: 1,
      to: 2,
      title: { from: 'Ablauf', to: 'Ablauf neu' },
      lines: [
        { type: 'unchanged', text: 'Inhalt von Ablauf' },
        { type: 'added', text: 'Neuer Schritt' },
      ],
    });

    const v1 = await anna.client.get(`/pages/${page.id}/versions/1`);
    expect(v1.body).toMatchObject({ version: 1, title: 'Ablauf', content: doc('Inhalt von Ablauf') });

    const restored = await anna.client.post(`/pages/${page.id}/restore/1`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ version: 3, title: 'Ablauf', content: doc('Inhalt von Ablauf') });
    const after = await anna.client.get(`/pages/${page.id}/versions`);
    expect(after.body[0]).toMatchObject({ version: 3, restoredFrom: 1, author: { displayName: 'anna' } });

    expect((await anna.client.get(`/pages/${page.id}/versions/9`)).status).toBe(404);
    expect((await anna.client.get(`/pages/${page.id}/diff?from=1&to=9`)).status).toBe(404);
    expect((await anna.client.get(`/pages/${page.id}/diff?from=x&to=2`)).status).toBe(400);
    expect((await anna.client.post(`/pages/${page.id}/restore/9`)).status).toBe(404);
  });
});

describe('Löschen und Papierkorb', () => {
  it('löscht Seiten samt Unterseiten in den Papierkorb und holt sie zurück', async () => {
    const space = await createSpace(anna.client);
    const a = await createPage(bernd.client, 'IT', 'A', space.homePageId);
    const a1 = await createPage(bernd.client, 'IT', 'A1', a.id);
    const b = await createPage(bernd.client, 'IT', 'B', space.homePageId);

    // Bearbeiter dürfen nicht löschen, die Startseite kann niemand löschen
    expect((await bernd.client.delete(`/pages/${a.id}`)).status).toBe(403);
    expect((await anna.client.delete(`/pages/${space.homePageId}`)).status).toBe(400);

    expect((await anna.client.delete(`/pages/${a.id}`)).status).toBe(204);
    expect((await bernd.client.get(`/pages/${a1.id}`)).status).toBe(404);
    expect((await bernd.client.put(`/pages/${a1.id}`, { title: 'x', content: doc('x'), version: 1 })).status).toBe(404);
    expect(await childTitles(bernd.client, 'IT', space.homePageId)).toEqual(['B']);
    expect((await tree(bernd.client, 'IT')).find((n) => n.id === b.id)?.position).toBe(0);

    expect((await bernd.client.get('/spaces/IT/trash')).status).toBe(403);
    const trash = await anna.client.get('/spaces/IT/trash');
    expect(trash.body).toHaveLength(1);
    expect(trash.body[0]).toMatchObject({ id: a.id, title: 'A', descendants: 1, deletedBy: { displayName: 'anna' } });

    // Unterseiten werden nur mit ihrer Elternseite zurückgeholt
    expect((await anna.client.post(`/pages/${a1.id}/undelete`)).status).toBe(400);
    expect((await bernd.client.post(`/pages/${a.id}/undelete`)).status).toBe(403);
    const restored = await anna.client.post(`/pages/${a.id}/undelete`);
    expect(restored.status).toBe(200);
    expect(await childTitles(bernd.client, 'IT', space.homePageId)).toEqual(['B', 'A']);
    expect((await bernd.client.get(`/pages/${a1.id}`)).status).toBe(200);
    expect((await anna.client.get('/spaces/IT/trash')).body).toEqual([]);

    const actions = (await ctx.prisma.auditLog.findMany({ where: { targetId: a.id } })).map((x) => x.action);
    expect(actions.sort()).toEqual(['page.deleted', 'page.restored']);
  });

  it('legt Seiten ohne lebende Elternseite oben im Space ab und leert den Papierkorb nach 30 Tagen', async () => {
    const space = await createSpace(anna.client);
    const a = await createPage(anna.client, 'IT', 'A', space.homePageId);
    const a1 = await createPage(anna.client, 'IT', 'A1', a.id);
    await anna.client.delete(`/pages/${a1.id}`).expect(204);
    await anna.client.delete(`/pages/${a.id}`).expect(204);
    expect((await anna.client.get('/spaces/IT/trash')).body).toHaveLength(2);

    const restored = await anna.client.post(`/pages/${a1.id}/undelete`);
    expect(restored.body).toMatchObject({ parentId: null, ancestors: [] });

    const pages = ctx.app.get(PagesService);
    expect(await pages.purgeTrash(new Date(Date.now() + 29 * 24 * 3600 * 1000))).toBe(0);
    expect(await pages.purgeTrash(new Date(Date.now() + 31 * 24 * 3600 * 1000))).toBe(1);
    expect(await ctx.prisma.page.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await ctx.prisma.pageVersion.count({ where: { pageId: a.id } })).toBe(0);
    expect((await anna.client.get(`/pages/${a1.id}`)).status).toBe(200);
  });
});

describe('Zugriffsschutz aller Spaces- und Seiten-Routen (S8)', () => {
  const routes = (pageId: string): [string, string, object?][] => [
    ['get', '/spaces'],
    ['post', '/spaces', { key: 'XY', name: 'X' }],
    ['get', '/spaces/IT'],
    ['patch', '/spaces/IT', { name: 'X' }],
    ['get', '/spaces/IT/tree'],
    ['get', '/spaces/IT/trash'],
    ['post', '/pages', { spaceKey: 'IT', title: 'X', content: doc('x') }],
    ['get', `/pages/${pageId}`],
    ['put', `/pages/${pageId}`, { title: 'X', content: doc('x'), version: 1 }],
    ['delete', `/pages/${pageId}`],
    ['post', `/pages/${pageId}/undelete`],
    ['post', `/pages/${pageId}/move`, { parentId: null, position: 0 }],
    ['get', `/pages/${pageId}/versions`],
    ['get', `/pages/${pageId}/versions/1`],
    ['get', `/pages/${pageId}/diff?from=1&to=1`],
    ['post', `/pages/${pageId}/restore/1`],
  ];

  async function call(client: Client, [method, path, body]: [string, string, object?]) {
    switch (method) {
      case 'get':
        return client.get(path);
      case 'post':
        return client.post(path, body);
      case 'put':
        return client.put(path, body);
      case 'patch':
        return client.patch(path, body);
      default:
        return client.delete(path);
    }
  }

  it('ohne Anmeldung oder ohne abgeschlossene 2FA gibt es 401', async () => {
    const space = await createSpace(anna.client);
    const anon = await new Client(ctx, '10.0.9.1').init();
    const partial = await new Client(ctx, '10.0.9.2').init();
    await partial.post('/auth/login', { email: bernd.email, password: PASSWORD });
    for (const route of routes(space.homePageId)) {
      expect([route[1], (await call(anon, route)).status]).toEqual([route[1], 401]);
      expect([route[1], (await call(partial, route)).status]).toEqual([route[1], 401]);
    }
    expect(await ctx.prisma.space.count()).toBe(1);
  });

  it('ohne CSRF-Token werden ändernde Anfragen abgelehnt (S5)', async () => {
    const space = await createSpace(anna.client);
    const res = await anna.client.agent
      .put(`/api/v1/pages/${space.homePageId}`)
      .set('Origin', 'http://wiki.test')
      .send({ title: 'X', content: doc('x'), version: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('unbekannte Seiten liefern 404, ungültige IDs 400', async () => {
    await createSpace(anna.client);
    const missing = '00000000-0000-4000-8000-000000000000';
    for (const route of routes(missing).filter(([, path]) => path.startsWith('/pages/'))) {
      expect([route[1], (await call(anna.client, route)).status]).toEqual([route[1], 404]);
    }
    expect((await anna.client.get('/pages/keine-uuid')).status).toBe(400);
  });
});
