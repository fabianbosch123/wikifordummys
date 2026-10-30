import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, nextCode, PASSWORD, run } from '../helpers';

const LIGHT_BG = 'rgb(246, 247, 249)';
const DARK_BG = 'rgb(20, 23, 28)';

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('Darstellung hell/dunkel je Benutzer, gespeichert im Konto', async ({ page, browser }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const email = `theme-${run}@example.de`;
  const secret = await acceptInviteAndSetup2fa(page, createAdminViaCli(email));

  // Standard: wie das Betriebssystem
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await background(page)).toBe(LIGHT_BG);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(page)).toBe(DARK_BG);
  await page.emulateMedia({ colorScheme: 'light' });

  // Im Profil auf Dunkel stellen: gilt sofort und bleibt nach dem Neuladen, schon im HTML vom Server
  await page.goto('/profile');
  await page.getByRole('radio', { name: /^Dunkel/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => background(page)).toBe(DARK_BG);
  const html = await (await page.request.get('/profile')).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Dunkel/ })).toBeChecked();
  expect(await background(page)).toBe(DARK_BG);

  // Umschalter in der Kopfzeile: Dunkel → System → Hell
  const toggle = page.getByRole('button', { name: /^Darstellung:/ });
  await toggle.click();
  await expect(page.getByRole('radio', { name: /^System/ })).toBeChecked();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await background(page)).toBe(LIGHT_BG);
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Hell bleibt hell, auch wenn das Betriebssystem dunkel ist
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await background(page)).toBe(LIGHT_BG);

  await page.getByRole('radio', { name: /^Dunkel/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Anderes Gerät ohne Cookie: nach der Anmeldung gilt die Einstellung aus dem Konto
  const other = await browser.newContext({ locale: 'de-DE', colorScheme: 'light' });
  const second = await other.newPage();
  await second.goto('/login');
  await expect(second.locator('html')).not.toHaveAttribute('data-theme');
  await second.getByLabel('E-Mail').fill(email);
  await second.getByLabel('Passwort').fill(PASSWORD);
  await second.getByRole('button', { name: 'Weiter' }).click();
  await second.getByLabel('Code aus der Authenticator-App').fill(nextCode(secret));
  await second.getByRole('button', { name: 'Anmelden' }).click();
  await expect(second.getByRole('heading', { name: /^Willkommen/ })).toBeVisible();
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(second)).toBe(DARK_BG);

  // Abmelden: der nächste Benutzer an diesem Browser startet wieder mit System
  await second.getByRole('button', { name: 'Abmelden' }).click();
  await expect(second).toHaveURL(/\/login/);
  await expect(second.locator('html')).not.toHaveAttribute('data-theme');
  await other.close();
});
