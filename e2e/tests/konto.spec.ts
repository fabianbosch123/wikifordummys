import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { acceptInviteAndSetup2fa, createAdminViaCli, nextCode, run } from '../helpers';

const spaceKey = `K${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const clipboard = (page: import('@playwright/test').Page) => page.evaluate(() => navigator.clipboard.readText());

test('Konto: lesbare Geräte, Wiederherstellungscodes kopieren und herunterladen', async ({ page }) => {
  const secret = await acceptInviteAndSetup2fa(page, createAdminViaCli(`konto-${run}@example.de`));
  await page.goto('/profile');

  // N-16: Browser und Betriebssystem statt roher Kennung (Playwright meldet sich als Chrome unter Windows)
  const devices = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Angemeldete Geräte' }) });
  await expect(devices.getByRole('cell', { name: /^Chrome unter Windows/ })).toBeVisible();
  await expect(devices.getByText('Mozilla/5.0')).toHaveCount(0);

  // N-15: neue Codes erzeugen, kopieren und als Datei speichern
  // Das Feld gibt es auch bei den API-Tokens (wenn MCP eingeschaltet ist), deshalb auf die Karte beschränken
  const recovery = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Wiederherstellungscodes' }) });
  await recovery.getByLabel('Code aus der App').fill(nextCode(secret));
  await page.getByRole('button', { name: 'Neue Codes erzeugen' }).click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  const codes = (await page.getByTestId('recovery-codes').locator('li').allTextContents()).map((c) => c.trim());

  await page.getByRole('button', { name: 'Codes kopieren' }).click();
  await expect(page.getByText('Kopiert.')).toBeVisible();
  const copied = await clipboard(page);
  for (const code of codes) expect(copied).toContain(code);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Als Textdatei herunterladen' }).click()]);
  expect(download.suggestedFilename()).toBe('wiki-wiederherstellungscodes.txt');
  const text = readFileSync((await download.path())!, 'utf8');
  for (const code of codes) expect(text).toContain(code);
});

test('Einladen: offene Einladung beim Namen nennen, erneut einladen, Link kopieren', async ({ page }) => {
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`einlader-${run}@example.de`));
  await page.getByRole('link', { name: 'Administration' }).click();
  const email = `bea-${run}@example.de`;

  async function invite() {
    await page.getByLabel('E-Mail').fill(email);
    await page.getByLabel('Anzeigename').fill('Bea');
    await page.getByRole('button', { name: 'Einladung senden' }).click();
  }

  await invite();
  const first = (await page.getByTestId('invite-link').textContent())!.trim();
  await page.getByRole('button', { name: 'Link kopieren' }).click();
  expect(await clipboard(page)).toBe(first);

  // N-20: dieselbe Adresse noch einmal
  await invite();
  await expect(page.locator('p.alert.error')).toHaveText(/schon eine Einladung offen/);
  await expect(page.getByText('bereits ein Konto')).toHaveCount(0);
  await page.locator('form').getByRole('button', { name: 'Erneut einladen' }).click();
  await expect(page.getByText(`Neue Einladung für ${email} angelegt.`)).toBeVisible();
  const second = (await page.getByTestId('invite-link').textContent())!.trim();
  expect(second).toContain('/invite/');
  expect(second).not.toBe(first);
  await expect(page.locator('p.alert.error')).toHaveCount(0);
  await expect(page.getByLabel('E-Mail')).toHaveValue('');
});

test('Nicht gefunden: deutsche Seite mit Weg zurück, auch für gelöschte Seiten', async ({ page }) => {
  // Ohne Anmeldung: unbekannte Adresse
  await page.goto('/gibtsnicht');
  await expect(page.getByRole('heading', { name: 'Diese Adresse gibt es nicht' })).toBeVisible();
  await expect(page.getByText('This page could not be found')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Zur Startseite' })).toBeVisible();

  await acceptInviteAndSetup2fa(page, createAdminViaCli(`notfound-${run}@example.de`));
  await page.goto('/gibtsnicht');
  await page.getByLabel('Im Wiki suchen').fill('Drucker');
  await page.getByRole('button', { name: 'Suchen' }).click();
  await expect(page).toHaveURL(/\/search\?q=Drucker/);

  await page.goto('/pages/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible();
  await expect(page.getByText(/Papierkorb/)).toBeVisible();
  await page.getByRole('link', { name: 'Zur Startseite' }).click();
  await expect(page.getByRole('heading', { name: /^Willkommen/ })).toBeVisible();

  await page.goto(`/spaces/GIBTS${spaceKey.slice(1, 5)}`);
  await expect(page.getByRole('heading', { name: 'Space nicht gefunden' })).toBeVisible();

  // Gelöschte Seite
  await page.getByRole('link', { name: 'Zur Startseite' }).click();
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Fundbüro');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill('Weg damit');
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Weg damit' })).toBeVisible();
  const url = page.url();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fundbüro' })).toBeVisible();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible();
  await page.goto(`${url}/history`);
  await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible();
});
