import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AttachmentDto, OfficeEditorDto } from '@wiki/shared';
import request from 'supertest';
import { signJwt, verifyJwt } from '../src/office/jwt';
import { emptyOfficeFile } from '../src/office/templates';
import { Account, createUser, ORIGIN, resetState, startApp, TestContext } from './helpers';
import { createPage, createSpace, PNG } from './fixtures';

const SECRET = 'office-test-secret-office-test-secret-123';

/** Minimales DOCX/XLSX: ZIP-Signatur genügt für die Typprüfung */
const zipFile = (text: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(text)]);
const DOCX = zipFile('fassung-1');

/** Ersatz für den Editor-Server: liefert unter /cache/... die "gespeicherte" Datei aus */
let saved = zipFile('fassung-2');
let fakeEditor: Server;
let editorUrl: string;

let ctx: TestContext;
let anna: Account;
let bernd: Account;
let pageId: string;

beforeAll(async () => {
  fakeEditor = createServer((req, res) => {
    if (req.url?.startsWith('/cache/')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': saved.length });
      res.end(saved);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => fakeEditor.listen(0, '127.0.0.1', resolve));
  editorUrl = `http://127.0.0.1:${(fakeEditor.address() as AddressInfo).port}`;
  process.env.OFFICE_ENABLED = 'true';
  process.env.OFFICE_JWT_SECRET = SECRET;
  process.env.OFFICE_INTERNAL_URL = editorUrl;
  process.env.OFFICE_API_URL = 'http://api:3001';
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
  fakeEditor.close();
  for (const key of ['OFFICE_ENABLED', 'OFFICE_JWT_SECRET', 'OFFICE_INTERNAL_URL', 'OFFICE_API_URL']) delete process.env[key];
});

beforeEach(async () => {
  await resetState(ctx);
  saved = zipFile('fassung-2');
  anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
  bernd = await createUser(ctx, 'bernd@example.de', { ip: '10.0.0.6' });
  await createSpace(anna.client, 'IT', 'IT-Team', { open: false });
  await anna.client.put('/spaces/IT/permissions', {
    entries: [
      { type: 'user', id: anna.userId, role: 'admin' },
      { type: 'user', id: bernd.userId, role: 'viewer' },
    ],
  });
  pageId = (await createPage(anna.client, 'IT', 'Mit Office')).id;
});

async function uploadDocx(name = 'Bericht.docx', data = DOCX): Promise<AttachmentDto> {
  const res = await anna.client.upload(pageId, name, data);
  expect(res.status).toBe(201);
  return res.body;
}

/** Rückruf wie vom Editor-Server: Angaben signiert im Feld token */
function callback(claims: Record<string, unknown>, secret = SECRET) {
  return request(ctx.app.getHttpServer())
    .post('/api/v1/office/callback')
    .set('X-Forwarded-For', '172.20.0.9')
    .send({ ...claims, token: signJwt(claims, secret) });
}

async function editorConfig(account: Account, id: string, mode: 'edit' | 'view') {
  return account.client.get(`/attachments/${id}/office?mode=${mode}`);
}

describe('Office-Editor', () => {
  it('zeigt je Benutzer an, ob ansehen oder bearbeiten möglich ist', async () => {
    await uploadDocx();
    await anna.client.upload(pageId, 'alt.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2]));
    await anna.client.upload(pageId, 'bild.png', PNG);
    const office = (list: AttachmentDto[]) => Object.fromEntries(list.map((a) => [a.filename, a.office]));
    expect(office((await anna.client.get(`/pages/${pageId}/attachments`)).body)).toEqual({ 'Bericht.docx': 'edit', 'alt.doc': 'view', 'bild.png': null });
    expect(office((await bernd.client.get(`/pages/${pageId}/attachments`)).body)).toEqual({ 'Bericht.docx': 'view', 'alt.doc': 'view', 'bild.png': null });
  });

  it('liefert eine signierte Konfiguration; Bearbeiten nur mit Bearbeiten-Recht', async () => {
    const a = await uploadDocx();
    const res = await editorConfig(anna, a.id, 'edit');
    expect(res.status).toBe(200);
    const body = res.body as OfficeEditorDto;
    expect(body.scriptUrl).toBe('/office/web-apps/apps/api/documents/api.js');
    const config = body.config as { token: string; document: { key: string; url: string }; editorConfig: { callbackUrl: string; mode: string } };
    expect(config).toMatchObject({
      documentType: 'word',
      document: { fileType: 'docx', title: 'Bericht.docx', permissions: { edit: true } },
      editorConfig: { mode: 'edit', callbackUrl: 'http://api:3001/api/v1/office/callback', user: { id: anna.userId, name: 'anna' } },
    });
    // Das Token enthält genau die Konfiguration; der Editor-Server prüft es mit dem gemeinsamen Geheimnis
    const { token, ...unsigned } = config;
    expect(verifyJwt(token, SECRET)).toEqual(unsigned);
    expect(verifyJwt(token, 'falsches-geheimnis-falsches-geheimnis-123')).toBeNull();

    // Zweites Öffnen: gleicher Schlüssel, damit beide in derselben Bearbeitung landen
    const viewer = await editorConfig(bernd, a.id, 'view');
    expect(viewer.status).toBe(200);
    expect(viewer.body.config).toMatchObject({ document: { key: config.document.key, permissions: { edit: false } }, editorConfig: { mode: 'view' } });
    expect((await editorConfig(bernd, a.id, 'edit')).status).toBe(403);

    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'attachment.office_opened' } });
    expect(audit).toHaveLength(1);
  });

  it('lehnt Dateien ab, deren Inhalt nicht zur Endung passt, und alte Formate zum Bearbeiten', async () => {
    const fake = await anna.client.upload(pageId, 'getarnt.docx', Buffer.from('<html>kein Word</html>'));
    expect((await editorConfig(anna, fake.body.id, 'view')).body.error.code).toBe('NOT_OFFICE');
    const png = await anna.client.upload(pageId, 'bild.png', PNG);
    expect((await editorConfig(anna, png.body.id, 'view')).status).toBe(400);
    const doc = await anna.client.upload(pageId, 'alt.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2]));
    expect((await editorConfig(anna, doc.body.id, 'view')).status).toBe(200);
    expect((await editorConfig(anna, doc.body.id, 'edit')).body.error.code).toBe('VIEW_ONLY');
  });

  it('der Editor-Server holt die Datei nur mit gültigem Link', async () => {
    const a = await uploadDocx();
    const { config } = (await editorConfig(anna, a.id, 'view')).body as OfficeEditorDto;
    const path = new URL((config.document as { url: string }).url).pathname;
    const anonymous = request(ctx.app.getHttpServer());
    const ok = await anonymous.get(path).buffer(true);
    expect(ok.status).toBe(200);
    expect(Buffer.compare(ok.body as Buffer, DOCX)).toBe(0);
    expect(ok.headers['content-type']).toBe('application/octet-stream');
    expect((await anonymous.get(`${path.slice(0, -3)}abc`)).status).toBe(404);
    expect((await anonymous.get('/api/v1/office/files/kein.gueltiges.token')).status).toBe(404);
    // Ein mit dem Editor-Geheimnis signierter Link gilt nicht: Datei-Links haben einen eigenen Schlüssel
    expect((await anonymous.get(`/api/v1/office/files/${signJwt({ att: a.id }, SECRET, 60)}`)).status).toBe(404);
  });

  it('speichert nach dem Rückruf eine neue Fassung; die alte bleibt abrufbar', async () => {
    const a = await uploadDocx();
    const { config } = (await editorConfig(anna, a.id, 'edit')).body as OfficeEditorDto;
    const key = (config.document as { key: string }).key;

    // Speichern-Knopf (Status 6): neue Fassung, Bearbeitung läuft weiter
    let res = await callback({ key, status: 6, url: `${ORIGIN}/office/cache/files/data/${key}/output.docx?md5=x`, users: [anna.userId] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ error: 0 });
    let row = await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ version: 2, sizeBytes: saved.length, officeKey: key });

    // Schließen ohne weitere Änderung (Status 2, gleicher Inhalt): keine neue Fassung, aber neue Sitzung beim nächsten Öffnen
    res = await callback({ key, status: 2, url: `${editorUrl}/cache/files/data/${key}/output.docx`, users: [anna.userId] });
    expect(res.body).toEqual({ error: 0 });
    row = await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ version: 2, officeKey: null });

    const versions = (await bernd.client.get(`/attachments/${a.id}/versions`)).body;
    expect(versions).toMatchObject([
      { version: 2, createdBy: { displayName: 'anna' } },
      { version: 1, createdBy: { displayName: 'anna' }, url: `/api/v1/attachments/${a.id}/versions/1` },
    ]);
    const old = await bernd.client.get(`/attachments/${a.id}/versions/1`).buffer(true);
    expect(Buffer.compare(old.body as Buffer, DOCX)).toBe(0);
    expect(old.headers['content-disposition']).toContain('Bericht (Fassung 1).docx');
    const current = await bernd.client.get(`/attachments/${a.id}?download=1`).buffer(true);
    expect(Buffer.compare(current.body as Buffer, saved)).toBe(0);
    expect((await ctx.prisma.auditLog.findMany({ where: { action: 'attachment.version_saved' } })).length).toBe(1);

    // Nächstes Öffnen bekommt einen neuen Schlüssel
    const again = (await editorConfig(anna, a.id, 'edit')).body as OfficeEditorDto;
    expect((again.config.document as { key: string }).key).not.toBe(key);
  });

  it('lehnt Rückrufe ohne gültige Signatur und fremde Download-Adressen ab', async () => {
    const a = await uploadDocx();
    const { config } = (await editorConfig(anna, a.id, 'edit')).body as OfficeEditorDto;
    const key = (config.document as { key: string }).key;
    const claims = { key, status: 2, url: `${editorUrl}/cache/x`, users: [anna.userId] };

    expect((await callback(claims, 'falsches-geheimnis-falsches-geheimnis-123')).status).toBe(403);
    const unsigned = await request(ctx.app.getHttpServer()).post('/api/v1/office/callback').send(claims);
    expect(unsigned.status).toBe(403);
    // Header-Variante der Docs-API: Angaben unter "payload"
    const header = await request(ctx.app.getHttpServer())
      .post('/api/v1/office/callback')
      .set('Authorization', `Bearer ${signJwt({ payload: { key, status: 4 } }, SECRET)}`)
      .send({ key, status: 4 });
    expect(header.body).toEqual({ error: 0 });

    for (const url of ['http://169.254.169.254/latest/meta-data', `${ORIGIN}/api/v1/attachments/${a.id}`, `http://user:pw@127.0.0.1/cache/x`, 'file:///etc/passwd']) {
      expect((await callback({ ...claims, url })).body).toEqual({ error: 1 });
    }
    expect((await callback({ ...claims, key: 'unbekannt' })).body).toEqual({ error: 1 });
    const row = await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.version).toBe(1);
  });

  it('legt leere Word-, Excel- und PowerPoint-Dateien als Anhang an, die der Editor öffnet', async () => {
    const created: AttachmentDto[] = [];
    for (const [kind, name, filename] of [
      ['docx', 'Protokoll', 'Protokoll.docx'],
      ['xlsx', ' Budget 2027.XLSX ', 'Budget 2027.xlsx'],
      ['pptx', 'Vortrag', 'Vortrag.pptx'],
    ]) {
      const res = await anna.client.post(`/pages/${pageId}/office-files`, { kind, name });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ filename, office: 'edit', version: 1, pageId });
      created.push(res.body);
    }
    // Inhalt ist die Vorlage; der Editor bekommt eine gültige Konfiguration zum Bearbeiten
    const file = await anna.client.get(`/attachments/${created[0].id}?download=1`).buffer(true);
    expect(Buffer.compare(file.body as Buffer, emptyOfficeFile('docx', 'Protokoll'))).toBe(0);
    for (const [i, documentType] of ['word', 'cell', 'slide'].entries()) {
      const res = await editorConfig(anna, created[i].id, 'edit');
      expect(res.status).toBe(200);
      expect(res.body.config).toMatchObject({ documentType, document: { permissions: { edit: true } } });
    }
    const list = (await anna.client.get(`/pages/${pageId}/attachments`)).body as AttachmentDto[];
    expect(list.map((a) => a.filename)).toEqual(['Protokoll.docx', 'Budget 2027.xlsx', 'Vortrag.pptx']);
  });

  it('neue Dateien nur mit Bearbeiten-Recht und nur in den vorgesehenen Formaten', async () => {
    expect((await bernd.client.post(`/pages/${pageId}/office-files`, { kind: 'docx', name: 'X' })).status).toBe(403);
    expect((await anna.client.post(`/pages/${pageId}/office-files`, { kind: 'doc', name: 'X' })).status).toBe(400);
    expect((await anna.client.post(`/pages/${pageId}/office-files`, { kind: 'docx', name: '' })).status).toBe(400);
    expect((await anna.client.post(`/pages/${pageId}/office-files`, { kind: 'docx', name: 'x'.repeat(201) })).status).toBe(400);
    expect(await ctx.prisma.attachment.count()).toBe(0);
  });

  it('liefert dem Editor-Server die leeren Vorlagen für office-check nur mit gültigem Link', async () => {
    const fileSecret = createHmac('sha256', process.env.SESSION_SECRET!).update('office-file').digest('hex');
    const anonymous = request(ctx.app.getHttpServer());
    const res = await anonymous.get(`/api/v1/office/files/${signJwt({ tpl: 'pptx' }, fileSecret, 60)}`).buffer(true);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, emptyOfficeFile('pptx', 'Prüfung'))).toBe(0);
    expect((await anonymous.get(`/api/v1/office/files/${signJwt({ tpl: 'exe' }, fileSecret, 60)}`)).status).toBe(404);
    expect((await anonymous.get(`/api/v1/office/files/${signJwt({ tpl: 'pptx' }, SECRET, 60)}`)).status).toBe(404);
  });

  it('Löschen entfernt alle Fassungen', async () => {
    const a = await uploadDocx();
    const { config } = (await editorConfig(anna, a.id, 'edit')).body as OfficeEditorDto;
    const key = (config.document as { key: string }).key;
    await callback({ key, status: 2, url: `${editorUrl}/cache/x`, users: [anna.userId] });
    expect(await ctx.prisma.attachmentVersion.count({ where: { attachmentId: a.id } })).toBe(2);
    expect((await anna.client.delete(`/attachments/${a.id}`)).status).toBe(204);
    expect(await ctx.prisma.attachmentVersion.count()).toBe(0);
  });
});
