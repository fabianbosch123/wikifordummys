import type { SearchResultDto } from '@wiki/shared';
import { toTsQuery } from '../src/search/search.service';
import { Account, Client, createUser, resetState, startApp, TestContext } from './helpers';
import { createPage, createSpace } from './fixtures';

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
});
