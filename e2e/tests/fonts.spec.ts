import { expect, Page, test } from '@playwright/test';
import { authenticator } from 'otplib';
import { createAdminWithPassword, PASSWORD, run } from '../helpers';

const spaceKey = `F${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

/**
 * Anmeldung mit Startpasswort statt Einladung: Einladungen sind je Adresse auf 30 Abrufe pro Stunde begrenzt,
 * und die übrigen Tests brauchen diese Abrufe schon.
 */
async function loginAsNewAdmin(page: Page) {
  const email = `fonts-${run}@example.de`;
  const startPassword = createAdminWithPassword(email);
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(startPassword);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page).toHaveURL(/\/setup-2fa$/);
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('6-stelliger Code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await page.getByLabel('Ich habe die Codes gesichert.').check();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByLabel('Startpasswort').fill(startPassword);
  await page.getByLabel('Neues Passwort', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Neues Passwort wiederholen').fill(PASSWORD);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(page.getByRole('heading', { name: 'Mein Konto' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Willkommen/ })).toBeVisible();
}

test('Schriftart im Editor wählen; die freie Ersatzschrift kommt vom eigenen Server', async ({ page }) => {
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fontRequests.push(r.url());
  });

  await loginAsNewAdmin(page);
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Schriften');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Schriften' })).toBeVisible();
  await page.keyboard.press('e');

  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Text in Georgia');
  await page.keyboard.press('Shift+Home');
  const select = page.getByRole('combobox', { name: 'Schriftart' });
  await expect(select.locator('option')).toHaveCount(11);
  await select.selectOption({ label: 'Georgia' });
  await expect(editor.locator('span[data-font="georgia"]')).toHaveText('Text in Georgia');
  await expect(select).toHaveValue('georgia');

  await page.keyboard.press('Control+s');
  await expect(page.getByText('Version 2 ·')).toBeVisible();
  const span = page.locator('.rich span[data-font="georgia"]');
  await expect(span).toHaveText('Text in Georgia');
  // Zuerst der gewohnte Name, dann die mitgelieferte freie Schrift (Georgia, weil Linux für Calibri oft schon Carlito installiert hat)
  expect(await span.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^Georgia, Gelasio/);
  await expect.poll(() => page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('16px Gelasio')))).toBe(true);
  expect(fontRequests.some((u) => /\/_next\/static\/media\/Gelasio-Variable\.[0-9a-f]+\.ttf$/.test(u))).toBe(true);
  expect(fontRequests.every((u) => new URL(u).origin === new URL(page.url()).origin)).toBe(true);

  // Schrift wieder entfernen
  await page.keyboard.press('e');
  await editor.locator('span[data-font="georgia"]').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await select.selectOption({ label: 'Standardschrift' });
  await expect(editor.locator('span[data-font]')).toHaveCount(0);
});
