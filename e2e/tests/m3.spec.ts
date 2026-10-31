import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `R${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

/** Kleinstes gültiges PNG (1×1 Pixel) */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('Rollen vergeben, Anhänge hochladen, Bild einbinden, Seite einschränken und suchen', async ({ page }) => {
  const cspViolations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
  });
  // Bildbeschreibung im Editor und Bestätigungen
  page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Logo der Firma' : undefined));

  await acceptInviteAndSetup2fa(page, createAdminViaCli(`rechte-${run}@example.de`));

  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Handbücher');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Handbücher' })).toBeVisible();

  // Rollen: alle-benutzer von Bearbeiter auf Leser herabstufen
  await page.getByRole('link', { name: 'Space-Einstellungen' }).click();
  await expect(page.getByRole('heading', { name: 'Rollen' })).toBeVisible();
  // Jede Änderung gilt sofort, ohne eigenen Speichern-Knopf (N-3)
  await page.getByLabel('Rolle für Gruppe alle-benutzer').selectOption('viewer');
  await expect(page.getByText('Gespeichert: Gruppe alle-benutzer ist jetzt Leser.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Rolle für Gruppe alle-benutzer')).toHaveValue('viewer');

  // Seite anlegen
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill('Druckeranleitung');
  await page.getByRole('textbox', { name: 'Seiteninhalt' }).click();
  await page.keyboard.type('So wird der Druckertreiber im zweiten Stock installiert.');
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Druckeranleitung' })).toBeVisible();

  // Anhänge: Bild mit Vorschau und eine HTML-Datei, die nur heruntergeladen wird
  await page.getByTestId('attachment-input').setInputFiles([
    { name: 'netzplan.png', mimeType: 'image/png', buffer: PNG },
    { name: 'boese.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert("xss")</script>') },
  ]);
  const attachments = page.locator('.attachment-list');
  await expect(attachments.getByRole('link', { name: 'netzplan.png' })).toBeVisible();
  await expect(attachments.getByRole('link', { name: 'boese.html' })).toBeVisible();
  await expect(attachments.locator('img')).toHaveJSProperty('naturalWidth', 1);
  const html = await page.request.get((await attachments.getByRole('link', { name: 'boese.html' }).getAttribute('href'))!);
  expect(html.headers()['content-type']).toBe('application/octet-stream');
  expect(html.headers()['content-disposition']).toMatch(/^attachment;/);

  // Bild im Editor hochladen und einbinden
  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  await page.getByRole('textbox', { name: 'Seiteninhalt' }).click();
  await page.keyboard.press('End');
  await page.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.editor-content img')).toHaveAttribute('src', /^\/api\/v1\/attachments\//);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Druckeranleitung' })).toBeVisible();
  const image = page.locator('article .rich img[alt="Logo der Firma"]');
  await expect(image).toHaveJSProperty('naturalWidth', 1);

  // Einschränkung „Ansehen“ auf die eigene Person
  await page.getByRole('button', { name: 'Einschränkungen' }).click();
  const viewList = page.locator('fieldset').filter({ hasText: 'Ansehen' });
  await viewList.getByLabel('Gruppe oder Person').selectOption({ label: 'Erste Admin' });
  await viewList.getByRole('button', { name: 'Hinzufügen' }).click();
  await page.getByRole('button', { name: 'Einschränkungen speichern' }).click();
  await expect(page.getByText('🔒 Ansehen eingeschränkt')).toBeVisible();

  // Suche über die Kopfzeile, mit hervorgehobenem Treffer
  await page.getByLabel('Wiki durchsuchen').fill('Druckertreiber');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=Druckertreiber/);
  const results = page.getByRole('list', { name: 'Suchergebnisse' });
  await expect(results.getByRole('link', { name: 'Druckeranleitung' }).first()).toBeVisible();
  await expect(results.locator('mark').first()).toHaveText('Druckertreiber');
  await page.getByLabel('Suchbegriff').fill('Kaffeemaschine');
  await page.getByRole('button', { name: 'Suchen' }).click();
  await expect(page.getByText('Keine Treffer für „Kaffeemaschine“.')).toBeVisible();

  expect(cspViolations).toEqual([]);
});
