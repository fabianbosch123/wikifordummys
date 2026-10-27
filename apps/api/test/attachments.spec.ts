import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AttachmentDto } from '@wiki/shared';
import { AttachmentStorageService } from '../src/attachments/attachment-storage.service';
import { APP_CONFIG, type AppConfig } from '../src/config';
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

  it('begrenzt die Menge je Benutzer und Tag und lehnt Uploads bei knappem Platz ab (SEC-003)', async () => {
    const config = ctx.app.get<AppConfig>(APP_CONFIG);
    const { ATTACHMENT_QUOTA_MB_PER_DAY: quota, ATTACHMENT_MIN_FREE_MB: reserve } = config;
    try {
      config.ATTACHMENT_QUOTA_MB_PER_DAY = 2;
      const mb = Buffer.alloc(1024 * 1024, 1);
      expect((await anna.client.upload(pageId, 'a.bin', mb)).status).toBe(201);
      expect((await anna.client.upload(pageId, 'b.bin', mb)).status).toBe(201);
      const third = await anna.client.upload(pageId, 'c.bin', Buffer.alloc(10, 1));
      expect(third.status).toBe(413);
      expect(third.body.error.code).toBe('QUOTA_EXCEEDED');
      // Andere Benutzer haben ihr eigenes Kontingent
      expect((await bernd.client.upload(pageId, 'd.bin', Buffer.alloc(10, 1))).status).toBe(201);

      config.ATTACHMENT_QUOTA_MB_PER_DAY = quota;
      const free = await ctx.app.get(AttachmentStorageService).freeBytes();
      config.ATTACHMENT_MIN_FREE_MB = Math.ceil(free / 1024 / 1024) + 1;
      const full = await bernd.client.upload(pageId, 'e.bin', Buffer.alloc(10, 1));
      expect(full.status).toBe(507);
      expect(full.body.error.code).toBe('STORAGE_FULL');
      expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
    } finally {
      config.ATTACHMENT_QUOTA_MB_PER_DAY = quota;
      config.ATTACHMENT_MIN_FREE_MB = reserve;
    }
  });

  it('räumt halbe Uploads aus abgebrochenen Anfragen weg, laufende bleiben', async () => {
    const tmp = join(dir, 'tmp');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'alt'), 'abgebrochen');
    writeFileSync(join(tmp, 'neu'), 'läuft noch');
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(join(tmp, 'alt'), twoHoursAgo, twoHoursAgo);
    expect(await ctx.app.get(AttachmentStorageService).removeStaleTmp()).toBe(1);
    expect(readdirSync(tmp)).toEqual(['neu']);
    rmSync(join(tmp, 'neu'));
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

describe('Zeichnungen: neue Fassungen und feste Fassungen auf Seiten', () => {
  /** Ein anderes gültiges PNG: gleiche Signatur, anderer Inhalt */
  const PNG2 = Buffer.concat([PNG, Buffer.from('zeichnung-2')]);

  it('speichert eine neue Fassung, zeigt Fassungen mit inline=1 an und verweist von der Seite auf eine feste Fassung', async () => {
    const a = (await anna.client.upload(pageId, 'Netz.drawio.png', PNG)).body as AttachmentDto;
    const res = await anna.client.uploadVersion(a.id, PNG2);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: a.id, version: 2, sizeBytes: PNG2.length, mimeType: 'image/png' });
    // Gleicher Inhalt ergibt keine weitere Fassung
    expect((await anna.client.uploadVersion(a.id, PNG2)).body).toMatchObject({ version: 2 });

    const v1 = await raw(bernd.client, `/attachments/${a.id}/versions/1?inline=1`);
    expect(v1.headers['content-type']).toBe('image/png');
    expect(v1.headers['content-disposition']).toMatch(/^inline;/);
    expect(Buffer.compare(v1.body as Buffer, PNG)).toBe(0);
    // Ohne inline=1 bleibt es beim Herunterladen
    expect((await raw(bernd.client, `/attachments/${a.id}/versions/1`)).headers['content-disposition']).toMatch(/^attachment;/);

    const content = { type: 'doc', content: [{ type: 'drawing', attrs: { attachmentId: a.id, version: 1, title: 'Netz', text: 'Router' } }] };
    const put = await anna.client.put(`/pages/${pageId}`, { title: 'Mit Zeichnung', content, version: 1 });
    expect(put.status).toBe(200);
    expect(put.body.content.content[0]).toEqual({ type: 'drawing', attrs: { attachmentId: a.id, version: 1, title: 'Netz', text: 'Router' } });
    // Beschriftungen der Zeichnung sind über die Suche auffindbar
    const hits = await bernd.client.get('/search?q=Router');
    expect(hits.body.results).toEqual([expect.objectContaining({ id: pageId })]);
  });

  it('antwortet mit 304, wenn der Browser den Stand schon hat; feste Fassungen dürfen im Browser bleiben', async () => {
    const a = (await anna.client.upload(pageId, 'Netz.drawio.png', PNG)).body as AttachmentDto;
    const first = await raw(bernd.client, `/attachments/${a.id}`);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const etag = first.headers.etag as string;

    const cached = await raw(bernd.client, `/attachments/${a.id}`).set('If-None-Match', etag);
    expect(cached.status).toBe(304);
    expect((cached.body as Buffer).length).toBe(0);
    expect(cached.headers.etag).toBe(etag);
    expect((await raw(bernd.client, `/attachments/${a.id}`).set('If-None-Match', `"x", W/${etag}`)).status).toBe(304);
    expect((await raw(bernd.client, `/attachments/${a.id}`).set('If-None-Match', '"anders"')).status).toBe(200);

    // Neue Fassung: der alte ETag passt nicht mehr, der Browser bekommt den neuen Inhalt
    await anna.client.uploadVersion(a.id, PNG2);
    const changed = await raw(bernd.client, `/attachments/${a.id}`).set('If-None-Match', etag);
    expect(changed.status).toBe(200);
    expect(Buffer.compare(changed.body as Buffer, PNG2)).toBe(0);

    const v1 = await raw(bernd.client, `/attachments/${a.id}/versions/1?inline=1`);
    expect(v1.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect((await raw(bernd.client, `/attachments/${a.id}/versions/1?inline=1`).set('If-None-Match', v1.headers.etag as string)).status).toBe(304);

    // Die Rechteprüfung kommt vor dem 304: ohne Zugriff hilft auch ein passender ETag nicht
    const carl = await createUser(ctx, 'carl@example.de', { ip: '10.0.0.7' });
    expect((await anna.client.put('/spaces/IT/permissions', { entries: [{ type: 'user', id: anna.userId, role: 'admin' }] })).status).toBe(200);
    expect((await raw(carl.client, `/attachments/${a.id}`).set('If-None-Match', changed.headers.etag as string)).status).toBe(404);
  });

  it('nur wer die Seite bearbeiten darf, speichert neue Fassungen; Leser sehen sie', async () => {
    const a = (await anna.client.upload(pageId, 'Netz.drawio.png', PNG)).body as AttachmentDto;
    await anna.client
      .put('/spaces/IT/permissions', {
        entries: [
          { type: 'user', id: anna.userId, role: 'admin' },
          { type: 'user', id: bernd.userId, role: 'viewer' },
        ],
      })
      .then((r) => expect(r.status).toBe(200));
    expect((await bernd.client.uploadVersion(a.id, PNG2)).status).toBe(403);
    expect((await raw(bernd.client, `/attachments/${a.id}/versions/1?inline=1`)).status).toBe(200);
    expect((await anna.client.uploadVersion(a.id, PNG2, 'application/json')).status).toBe(400);
    expect((await anna.client.uploadVersion(a.id, Buffer.alloc(0))).status).toBe(400);
    expect((await anna.client.uploadVersion('00000000-0000-4000-8000-000000000000', PNG2)).status).toBe(404);
    expect(await ctx.prisma.attachmentVersion.count({ where: { attachmentId: a.id } })).toBe(1);
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
  });

  it('meldet eingeschaltete Dienste', async () => {
    expect((await bernd.client.get('/features')).body).toEqual({ office: expect.any(Boolean), drawio: false });
  });
});
