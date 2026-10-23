import { expect, test } from '@playwright/test';
import { authenticator } from 'otplib';
import { createAdminWithPassword, PASSWORD, run } from '../helpers';

test('Erster Admin mit Startpasswort aus der Shell: 2FA, dann Pflicht zum Passwortwechsel', async ({ page }) => {
  const email = `shell-${run}@example.de`;
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

  // Vor dem Passwortwechsel führt jede Seite zum Formular
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeVisible();
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel('Startpasswort').fill(startPassword);
  await page.getByLabel('Neues Passwort', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Neues Passwort wiederholen').fill(PASSWORD);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();

  await expect(page.getByRole('heading', { name: 'Mein Konto' })).toBeVisible();
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(page).toHaveURL(/\/admin\/users/);
});
