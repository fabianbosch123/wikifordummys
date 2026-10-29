import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `F${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

test('Schriftart im Editor wählen; die freie Ersatzschrift kommt vom eigenen Server', async ({ page }) => {
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fontRequests.push(r.url());
  });

  await acceptInviteAndSetup2fa(page, createAdminViaCli(`fonts-${run}@example.de`));
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
