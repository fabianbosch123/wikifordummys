import type { SearchResultDto } from '@wiki/shared';
import { filenamePatterns, tidySnippet, toTsQuery } from '../src/search/search.service';
import { Account, Client, createUser, resetState, startApp, TestContext } from './helpers';
import { createPage, createSpace, PNG } from './fixtures';

let ctx: TestContext;
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
  anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.0.5' });
  bernd = await createUser(ctx, 'bernd@example.de', { ip: '10.0.0.6' });
});

async function search(client: Client, query: string): Promise<SearchResultDto> {
  const res = await client.get(`/search?${query}`);
  expect(res.status).toBe(200);
  return res.body;
}

const titles = (r: SearchResultDto) => r.results.map((h) => h.title);

describe('Volltextsuche', () => {
  it('findet Titel und Inhalt mit deutschem Wörterbuch und Wortanfängen; Titel zählen mehr', async () => {
    await createSpace(anna.client);
    await createPage(anna.client, 'IT', 'Netzwerk', undefined, 'Die Drucker im zweiten Stock hängen am Switch 3.');
    await createPage(anna.client, 'IT', 'Druckeranleitung', undefined, 'Toner wechseln.');
    await createPage(anna.client, 'IT', 'Urlaub', undefined, 'Nichts zum Thema.');

    expect(titles(await search(bernd.client, 'q=Drucker'))).toEqual(['Druckeranleitung', 'Netzwerk']);
    expect(titles(await search(bernd.client, 'q=druck'))).toEqual(['Druckeranleitung', 'Netzwerk']);
    expect(titles(await search(bernd.client, 'q=Druckern%20Switch'))).toEqual(['Netzwerk']);
    expect(titles(await search(bernd.client, 'q=Toner'))).toEqual(['Druckeranleitung']);
    expect(titles(await search(bernd.client, 'q=Kaffeemaschine'))).toEqual([]);

    const hit = (await search(bernd.client, 'q=Switch')).results[0];
    expect(hit).toMatchObject({ title: 'Netzwerk', spaceKey: 'IT', spaceName: 'IT-Team' });
    expect(hit.snippet.filter((s) => s.match).map((s) => s.text)).toEqual(['Switch']);
    expect(hit.snippet.map((s) => s.text).join('')).toContain('Drucker im zweiten Stock hängen');
  });

  it('nach Änderungen ist der Index sofort aktuell; gelöschte Seiten fehlen', async () => {
    await createSpace(anna.client);
    const page = await createPage(anna.client, 'IT', 'VPN', undefined, 'Alter Zugang über OpenVPN.');
    await anna.client.put(`/pages/${page.id}`, {
      title: 'VPN',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Neuer Zugang über WireGuard.' }] }] },
      version: 1,
    });
    expect(titles(await search(bernd.client, 'q=WireGuard'))).toEqual(['VPN']);
    expect(titles(await search(bernd.client, 'q=OpenVPN'))).toEqual([]);
    await anna.client.delete(`/pages/${page.id}`).expect(204);
    expect(titles(await search(bernd.client, 'q=WireGuard'))).toEqual([]);
  });

  it('filtert nach Rechten: Spaces ohne Rolle und eingeschränkte Seiten samt Unterseiten fehlen (S8)', async () => {
    await createSpace(anna.client, 'IT');
    await createSpace(anna.client, 'HR', 'Personal', { open: false });
    await createPage(anna.client, 'HR', 'Gehälter', undefined, 'Vertraulich Budget');
    const secret = await createPage(anna.client, 'IT', 'Passwörter', undefined, 'Vertraulich Tresor');
    await createPage(anna.client, 'IT', 'Unterseite', secret.id, 'Vertraulich Detail');
    await createPage(anna.client, 'IT', 'Öffentlich', undefined, 'Vertraulich? Nein.');
    await anna.client.put(`/pages/${secret.id}/restrictions`, { view: [{ type: 'user', id: anna.userId }], edit: [] });

    expect(titles(await search(bernd.client, 'q=vertraulich'))).toEqual(['Öffentlich']);
    expect(titles(await search(anna.client, 'q=vertraulich')).sort()).toEqual(['Gehälter', 'Passwörter', 'Unterseite', 'Öffentlich']);
    expect(titles(await search(anna.client, 'q=vertraulich&space=HR'))).toEqual(['Gehälter']);
    expect((await bernd.client.get('/search?q=vertraulich&space=HR')).status).toBe(404);
  });

  it('Eingaben können die Abfrage nicht manipulieren (S9) und werden seitenweise geliefert', async () => {
    await createSpace(anna.client);
    for (let i = 0; i < 22; i++) await createPage(anna.client, 'IT', `Handbuch ${i}`);
    const first = await search(bernd.client, 'q=Handbuch');
    expect(first.results).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const second = await search(bernd.client, 'q=Handbuch&offset=20');
    expect(second.results).toHaveLength(2);
    expect(second.hasMore).toBe(false);

    for (const q of ["a & | ! :* ( ) ' \\", "'; DROP TABLE pages; --", '<script>', 'der die das']) {
      expect((await bernd.client.get(`/search?q=${encodeURIComponent(q)}`)).status).toBe(200);
    }
    for (const bad of ['', 'q=', `q=${'x'.repeat(201)}`, 'q=x&offset=-1', 'q=x&space=../']) {
      expect([bad, (await bernd.client.get(`/search?${bad}`)).status]).toEqual([bad, 400]);
    }
    expect(toTsQuery('Drucker & Switch!')).toBe('Drucker:* & Switch:*');
    expect(toTsQuery('!!!')).toBeNull();
  });

  it('zeigt den Pfad der übergeordneten Seiten, damit gleiche Titel unterscheidbar sind (N-4)', async () => {
    await createSpace(anna.client);
    const team = await createPage(anna.client, 'IT', 'Team');
    const office = await createPage(anna.client, 'IT', 'Büro', team.id);
    await createPage(anna.client, 'IT', 'Drucker Anleitung', team.id, 'Toner Team');
    await createPage(anna.client, 'IT', 'Drucker Anleitung', office.id, 'Toner Büro');
    const hits = (await search(bernd.client, 'q=Toner')).results;
    expect(hits.map((h) => h.path).sort((a, b) => a.length - b.length)).toEqual([['Team'], ['Team', 'Büro']]);
  });

  it('räumt Ausschnitte auf: keine leeren Tabellenzellen, keine Bild-Platzhalter (N-14)', async () => {
    await createSpace(anna.client);
    const page = await createPage(anna.client, 'IT', 'Telefonliste');
    const cell = (text?: string) => ({ type: 'tableCell', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] });
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Drucker im Keller' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [cell('Name'), cell('Telefon'), cell(), cell(), cell()] }, { type: 'tableRow', content: [cell(), cell(), cell(), cell(), cell()] }] },
        { type: 'image', attrs: { src: 'https://example.org/rot.png', alt: 'Rotes Testbild' } },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Der Drucker steht im Keller.' }] },
      ],
    };
    await anna.client.put(`/pages/${page.id}`, { title: 'Telefonliste', content, version: 1 }).expect(200);
    const hit = (await search(bernd.client, 'q=Drucker')).results[0];
    const text = hit.snippet.map((s) => s.text).join('');
    expect(text).not.toMatch(/\||\[Bild|##|---/);
    expect(text).not.toMatch(/·\s*·/);
    expect(text).toContain('Name · Telefon');
    expect(text).toContain('Der Drucker steht im Keller');
    // Bildbeschreibungen bleiben auffindbar, nur der Ausschnitt lässt sie weg
    expect(titles(await search(bernd.client, 'q=Testbild'))).toEqual(['Telefonliste']);

    expect(tidySnippet([{ text: ' · Name ·  · ', match: false }, { text: 'Drucker', match: true }, { text: ' · ', match: false }])).toEqual([
      { text: 'Name · ', match: false },
      { text: 'Drucker', match: true },
    ]);
  });

  it('findet Anhänge über den Dateinamen, mit Seite und Pfad und nur mit Leserechten (N-6)', async () => {
    await createSpace(anna.client);
    await createSpace(anna.client, 'HR', 'Personal', { open: false });
    const folder = await createPage(anna.client, 'IT', 'Ordner');
    const page = await createPage(anna.client, 'IT', 'Ablage', folder.id);
    const secret = await createPage(anna.client, 'IT', 'Geheim');
    const hr = await createPage(anna.client, 'HR', 'Personalakte');
    await anna.client.upload(page.id, 'notiz.txt', Buffer.from('hallo')).expect(201);
    await anna.client.upload(page.id, 'Bild Notizen.png', PNG).expect(201);
    await anna.client.upload(secret.id, 'notiz-geheim.txt', Buffer.from('x')).expect(201);
    await anna.client.upload(hr.id, 'notiz-hr.txt', Buffer.from('x')).expect(201);
    await anna.client.put(`/pages/${secret.id}/restrictions`, { view: [{ type: 'user', id: anna.userId }], edit: [] }).expect(200);

    const r = await search(bernd.client, 'q=notiz');
    expect(r.results).toEqual([]);
    expect(r.attachments.map((a) => a.filename).sort()).toEqual(['Bild Notizen.png', 'notiz.txt']);
    const hit = r.attachments.find((a) => a.filename === 'notiz.txt')!;
    expect(hit).toMatchObject({ pageId: page.id, pageTitle: 'Ablage', spaceKey: 'IT', spaceName: 'IT-Team', url: `/api/v1/attachments/${hit.id}` });
    expect(hit.path).toEqual(['Ordner']);

    expect((await search(bernd.client, 'q=notiz%20txt')).attachments.map((a) => a.filename)).toEqual(['notiz.txt']);
    expect((await search(anna.client, 'q=notiz')).attachments).toHaveLength(4);
    expect((await search(bernd.client, 'q=notiz&offset=20')).attachments).toEqual([]);

    // Nach dem Löschen der Seite (Papierkorb) ist auch der Anhang nicht mehr zu finden
    await anna.client.delete(`/pages/${page.id}`).expect(204);
    expect((await search(bernd.client, 'q=notiz')).attachments).toEqual([]);

    expect(filenamePatterns('50%_rabatt')).toEqual(['%50%', '%rabatt%']);
  });
});
