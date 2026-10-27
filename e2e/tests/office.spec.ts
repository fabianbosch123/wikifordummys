import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { e2eEnv } from '../env';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `O${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

/** Für die Typprüfung genügt die ZIP-Signatur am Anfang */
const docx = (text: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(text)]);
const SAVED = docx('vom Editor gespeichert');

/** Attrappe von api.js: zeigt die übergebene Konfiguration an, statt den echten Editor zu laden */
const FAKE_API_JS = `
window.DocsAPI = {
  DocEditor: function (id, config) {
    var el = document.getElementById(id);
    el.setAttribute('data-config', JSON.stringify(config));
    el.textContent = 'Editor: ' + config.document.title + ' (' + config.editorConfig.mode + ')';
    this.destroyEditor = function () {};
  },
};`;

/** HS256 wie der Editor-Server, damit der Rückruf als echt gilt */
function sign(claims: object): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}`;
  return `${data}.${createHmac('sha256', e2eEnv.OFFICE_JWT_SECRET).update(data).digest('base64url')}`;
}

/** Attrappe des Editor-Servers: liefert die "gespeicherte" Datei aus (OFFICE_INTERNAL_URL in env.ts) */
let editorServer: Server;
test.beforeAll(async () => {
  editorServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(SAVED);
  });
  await new Promise<void>((resolve) => editorServer.listen(Number(new URL(e2eEnv.OFFICE_INTERNAL_URL).port), '127.0.0.1', resolve));
});
test.afterAll(() => {
  editorServer.close();
});

test('Office-Dokument ansehen, bearbeiten und als neue Fassung speichern', async ({ page, request }) => {
  const cspViolations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
  });
  await page.route('**/office/web-apps/apps/api/documents/api.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_API_JS }),
  );

  await acceptInviteAndSetup2fa(page, createAdminViaCli(`office-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Vorlagen');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill('Formulare');
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Formulare' })).toBeVisible();
  const pageUrl = page.url();

  await page.getByTestId('attachment-input').setInputFiles([{ name: 'Urlaubsantrag.docx', mimeType: 'application/octet-stream', buffer: docx('fassung 1') }]);
  const item = page.locator('.attachment-list li', { hasText: 'Urlaubsantrag.docx' });
  await expect(item.getByRole('link', { name: 'Ansehen' })).toBeVisible();

  // Bearbeiten öffnet den Editor mit signierter Konfiguration
  await item.getByRole('link', { name: 'Bearbeiten' }).click();
  await expect(page).toHaveURL(/\/attachments\/[^/]+\/office\?mode=edit$/);
  const editor = page.getByTestId('office-editor');
  await expect(editor).toHaveText('Editor: Urlaubsantrag.docx (edit)');
  const config = JSON.parse((await editor.getAttribute('data-config'))!);
  expect(config).toMatchObject({ documentType: 'word', document: { fileType: 'docx', permissions: { edit: true } }, width: '100%' });
  expect(config.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  expect(cspViolations).toEqual([]);

  // Speichern im Editor: der Editor-Server ruft die API zurück
  const claims = { key: config.document.key, status: 2, url: `${e2eEnv.OFFICE_INTERNAL_URL}/cache/output.docx`, users: [config.editorConfig.user.id] };
  const res = await request.post(`${e2eEnv.OFFICE_API_URL}/api/v1/office/callback`, { data: { ...claims, token: sign(claims) } });
  expect(await res.json()).toEqual({ error: 0 });

  await page.getByRole('link', { name: '← Zurück zur Seite' }).click();
  await expect(page).toHaveURL(pageUrl);
  await item.getByText('Fassung 2').click();
  await expect(item.getByRole('link', { name: 'Fassung 1' })).toBeVisible();
  await expect(item.getByText('Fassung 2 (aktuell)')).toBeVisible();
  const current = await page.request.get((await item.getByRole('link', { name: 'Urlaubsantrag.docx' }).getAttribute('href'))!);
  expect(Buffer.compare(await current.body(), SAVED)).toBe(0);
});

test('neue Excel-Tabelle aus dem Seiteneditor anlegen und im Office-Editor öffnen', async ({ page, context }) => {
  await context.route('**/office/web-apps/apps/api/documents/api.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_API_JS }),
  );
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`office-neu-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(`${spaceKey.slice(0, 6)}N`);
  await page.getByLabel('Name', { exact: true }).fill('Planung');
  await page.getByRole('button', { name: 'Space anlegen' }).click();

  // Neue Seite: erst nach dem Anlegen möglich, weil die Datei ein Anhang der Seite wird
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await expect(page.getByRole('button', { name: 'Neue Office-Datei (erst nach dem Anlegen der Seite möglich)' })).toBeDisabled();
  await page.getByLabel('Titel').fill('Budget');
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Budget' })).toBeVisible();
  const pageUrl = page.url();

  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  await page.locator('.editor-content').click();
  await page.getByRole('button', { name: 'Neue Word-, Excel- oder PowerPoint-Datei anlegen' }).click();
  await page.getByLabel('Neu', { exact: true }).selectOption('xlsx');
  await expect(page.getByLabel('Dateiname')).toHaveValue('Neue Tabelle');
  await page.getByLabel('Dateiname').fill('Budget 2027');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Anlegen und öffnen' }).click();

  // Neuer Tab mit dem Office-Editor zum Bearbeiten; die Seite bleibt im Editor offen
  const tab = await popup;
  await expect(tab).toHaveURL(/\/attachments\/[^/]+\/office\?mode=edit$/);
  const editor = tab.getByTestId('office-editor');
  await expect(editor).toHaveText('Editor: Budget 2027.xlsx (edit)');
  expect(JSON.parse((await editor.getAttribute('data-config'))!)).toMatchObject({ documentType: 'cell', document: { fileType: 'xlsx' } });
  await tab.close();

  // Link an der Cursorposition, nach dem Speichern auf der Seite und im Anhänge-Panel
  await expect(page.locator('.editor-content a', { hasText: '📎 Budget 2027.xlsx' })).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page).toHaveURL(pageUrl);
  const link = page.locator('.rich a', { hasText: '📎 Budget 2027.xlsx' });
  await expect(link).toHaveAttribute('href', /^\/attachments\/[^/]+\/office$/);
  const item = page.locator('.attachment-list li', { hasText: 'Budget 2027.xlsx' });
  await expect(item.getByRole('link', { name: 'Bearbeiten' })).toBeVisible();
  const file = await page.request.get(`${(await item.getByRole('link', { name: 'Budget 2027.xlsx' }).getAttribute('href'))!}?download=1`);
  expect((await file.body()).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  // Link auf der Seite öffnet die Ansicht
  await link.click();
  await expect(page.getByTestId('office-editor')).toHaveText('Editor: Budget 2027.xlsx (view)');
});
