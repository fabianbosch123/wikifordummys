import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AttachmentDto } from '@wiki/shared';
import { PagesService } from '../src/pages/pages.service';
import { Account, Client, createUser, resetState, startApp, TestContext } from './helpers';
import { createPage, createSpace, PNG } from './fixtures';

let ctx: TestContext;
let anna: Account;
let bernd: Account;
let pageId: string;

const dir = process.env.ATTACHMENTS_DIR!;
const fileOf = async (id: string) => {
  const { storageKey } = await ctx.prisma.attachment.findUniqueOrThrow({ where: { id } });
  return join(dir, storageKey.slice(0, 2), storageKey);
};

beforeAll(async () => {
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await resetState(ctx);
  anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
  bernd = await createUser(ctx, 'bernd@example.de', { ip: '10.0.0.6' });
  await createSpace(anna.client);
  pageId = (await createPage(anna.client, 'IT', 'Mit Anhängen')).id;
});

/** Liest die Antwort als Buffer, unabhängig vom Content-Type */
function raw(client: Client, path: string) {
  return client
    .get(path)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
}

describe('Anhänge hochladen und abrufen', () => {
  it('speichert Bilder unter zufälligem Namen und zeigt sie inline an', async () => {
    const res = await anna.client.upload(pageId, 'Screenshot Übersicht.png', PNG);
    expect(res.status).toBe(201);
    const a = res.body as AttachmentDto;
    expect(a).toMatchObject({ pageId, filename: 'Screenshot Übersicht.png', mimeType: 'image/png', preview: 'image', sizeBytes: PNG.length, url: `/api/v1/attachments/${a.id}` });

    const row = await ctx.prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.storageKey).not.toContain('Screenshot');
    expect(existsSync(await fileOf(a.id))).toBe(true);

    const get = await raw(bernd.client, `/attachments/${a.id}`);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['content-disposition']).toBe(`inline; filename="Screenshot _bersicht.png"; filename*=UTF-8''Screenshot%20%C3%9Cbersicht.png`);
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(get.headers['content-security-policy']).toContain("default-src 'none'");
    expect(get.headers.etag).toBe(`"${row.sha256}"`);
    expect(Buffer.compare(get.body as Buffer, PNG)).toBe(0);

    const download = await raw(bernd.client, `/attachments/${a.id}?download=1`);
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);

    const list = await bernd.client.get(`/pages/${pageId}/attachments`);
    expect(list.body).toMatchObject([{ id: a.id, uploadedBy: { displayName: 'anna' } }]);
  });

  it('erkennt den Typ am Inhalt: HTML und SVG werden nie angezeigt, nur heruntergeladen (S7)', async () => {
    const payloads: [string, string][] = [
      ['boese.html', '<html><script>alert(1)</script></html>'],
      ['bild.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>'],
      ['getarnt.png', '<script>alert(3)</script>'],
      ['getarnt.pdf', '<html>kein PDF</html>'],
    ];
    for (const [name, content] of payloads) {
      const res = await anna.client.upload(pageId, name, Buffer.from(content));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ filename: name, mimeType: 'application/octet-stream', preview: null });
      const get = await raw(anna.client, `/attachments/${res.body.id}`);
      expect(get.headers['content-type']).toBe('application/octet-stream');
      expect(get.headers['content-disposition']).toMatch(/^attachment; filename="/);
      expect(get.headers['x-content-type-options']).toBe('nosniff');
    }
    const pdf = await anna.client.upload(pageId, 'echt.pdf', Buffer.from('%PDF-1.7\n%…'));
    expect(pdf.body).toMatchObject({ mimeType: 'application/pdf', preview: 'pdf' });
    const get = await raw(anna.client, `/attachments/${pdf.body.id}`);
    expect(get.headers['content-type']).toBe('application/pdf');
    expect(get.headers['content-disposition']).toMatch(/^inline;/);
  });

  it('bereinigt Dateinamen und lehnt andere Upload-Formate ab', async () => {
    const cases: [string, string][] = [
      ['../../etc/passwd', 'passwd'],
      ['C:\\Users\\x\\bericht.docx', 'bericht.docx'],
      ['zeile\numbruch\u202e.txt', 'zeileumbruch.txt'],
      ['..', 'datei'],
      ['"; filename="x.html', '"; filename="x.html'],
    ];
    for (const [input, expected] of cases) {
      const res = await anna.client.upload(pageId, input, Buffer.from('x'));
      expect([input, res.status, res.body.filename]).toEqual([input, 201, expected]);
    }
    const tricky = (await anna.client.get(`/pages/${pageId}/attachments`)).body.find((a: AttachmentDto) => a.filename.startsWith('"'));
    const get = await raw(anna.client, `/attachments/${tricky.id}`);
    expect(get.headers['content-disposition']).toBe(`attachment; filename="__ filename=_x.html"; filename*=UTF-8''%22%3B%20filename%3D%22x.html`);

    expect((await anna.client.upload(pageId, 'a.png', PNG, 'application/json')).status).toBe(400);
    expect((await anna.client.upload(pageId, 'a.png', PNG, 'multipart/form-data; boundary=x')).status).toBe(400);
    expect((await anna.client.post(`/pages/${pageId}/attachments`)).status).toBe(400);
    expect((await anna.client.upload(pageId, 'leer.txt', Buffer.alloc(0))).status).toBe(400);
  });

  it('lehnt zu große Dateien ab und hinterlässt keine Reste (S7)', async () => {
    const tooBig = Buffer.alloc(1024 * 1024 + 1, 1);
    const res = await anna.client.upload(pageId, 'gross.bin', tooBig);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('TOO_LARGE');
    expect(await ctx.prisma.attachment.count()).toBe(0);
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
    // Genau an der Grenze ist erlaubt
    expect((await anna.client.upload(pageId, 'grenze.bin', Buffer.alloc(1024 * 1024, 1))).status).toBe(201);
  });

  it('Anhänge im Papierkorb sind nicht erreichbar; endgültiges Löschen entfernt die Dateien', async () => {
    const a = (await anna.client.upload(pageId, 'bild.png', PNG)).body as AttachmentDto;
    const file = await fileOf(a.id);
    await anna.client.delete(`/pages/${pageId}`).expect(204);
    expect((await anna.client.get(`/attachments/${a.id}`)).status).toBe(404);
    expect((await anna.client.get(`/pages/${pageId}/attachments`)).status).toBe(404);
    expect((await anna.client.upload(pageId, 'x.png', PNG)).status).toBe(404);

    const purged = await ctx.app.get(PagesService).purgeTrash(new Date(Date.now() + 31 * 24 * 3600 * 1000));
    expect(purged).toBe(1);
    expect(await ctx.prisma.attachment.count()).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  it('Löschen eines Anhangs entfernt die Datei und wird protokolliert (S12)', async () => {
    const a = (await anna.client.upload(pageId, 'bild.png', PNG)).body as AttachmentDto;
    const file = await fileOf(a.id);
    await bernd.client.delete(`/attachments/${a.id}`).expect(204);
    expect(existsSync(file)).toBe(false);
    expect((await anna.client.get(`/attachments/${a.id}`)).status).toBe(404);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'attachment.deleted' } });
    expect(audit).toMatchObject({ actorId: bernd.userId, targetId: a.id, details: { filename: 'bild.png', pageId } });
  });

  it('hochgeladene Bilder lassen sich in Seiten einbinden', async () => {
    const a = (await anna.client.upload(pageId, 'bild.png', PNG)).body as AttachmentDto;
    const content = { type: 'doc', content: [{ type: 'image', attrs: { src: a.url, alt: 'Bild' } }] };
    const res = await anna.client.put(`/pages/${pageId}`, { title: 'Mit Bild', content, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.content.content[0].attrs.src).toBe(a.url);
  });
});
