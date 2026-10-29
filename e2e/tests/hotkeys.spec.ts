import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `H${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

test('Tastenkürzel: E öffnet den Editor, Strg+S speichert', async ({ page }) => {
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`hotkeys-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Kürzel');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kürzel' })).toBeVisible();
  await expect(page).toHaveURL(/\/pages\/[^/]+$/);
  const viewUrl = page.url();
  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });

  // Im Suchfeld ist „e“ nur ein Buchstabe
  await page.locator('#topbar-search').fill('');
  await page.locator('#topbar-search').press('e');
  await expect(page.locator('#topbar-search')).toHaveValue('e');
  expect(page.url()).toBe(viewUrl);

  // Mit Strg bleibt „e“ frei
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+e');
  expect(page.url()).toBe(viewUrl);

  // E öffnet den Editor
  await page.keyboard.press('e');
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/\/edit$/);

  // „e“ im Editor ist Text, Strg+S speichert aus dem Editor heraus
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Neu per Tastatur.');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Version 2 ·')).toBeVisible();
  await expect(page.locator('.rich')).toContainText('Neu per Tastatur.');

  // Strg+S auch ohne Fokus im Formular
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('e');
  await expect(editor).toBeVisible();
  await page.getByLabel('Titel').fill('Kürzel neu');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('heading', { level: 1, name: 'Kürzel neu' })).toBeVisible();
  await expect(page.getByText('Version 3 ·')).toBeVisible();
});
