import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, nextCode, PASSWORD, run } from '../helpers';

test('Erster Admin: Einladung, Pflicht-2FA, Benutzer einladen, erneuter Login', async ({ page, context }) => {
  const adminEmail = `admin-${run}@example.de`;
  const secret = await acceptInviteAndSetup2fa(page, createAdminViaCli(adminEmail));

  // Benutzer einladen; ohne Mailserver zeigt die Oberfläche den Link an
  await page.getByRole('link', { name: 'Administration' }).click();
  await page.getByLabel('E-Mail').fill(`anna-${run}@example.de`);
  await page.getByLabel('Anzeigename').fill('Anna');
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  const inviteLink = (await page.getByTestId('invite-link').textContent())!.trim();
  expect(inviteLink).toContain('/invite/');
  await expect(page.getByRole('cell', { name: new RegExp(`anna-${run}@`) })).toBeVisible();

  // Abmelden; ohne Anmeldung kein Zugriff
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login/);

  // Login: Passwort allein reicht nicht
  await page.getByLabel('E-Mail').fill(adminEmail);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page).toHaveURL(/\/login\/2fa/);
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\/2fa/);

  await page.getByLabel('Code aus der Authenticator-App').fill(nextCode(secret));
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText('dieses Gerät')).toBeVisible();

  // Die eingeladene Person richtet ihr Konto in einem eigenen Browser-Kontext ein
  const other = await context.browser()!.newContext();
  const annaPage = await other.newPage();
  await acceptInviteAndSetup2fa(annaPage, inviteLink);
  await expect(annaPage.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  await annaPage.goto('/admin/users');
  await expect(annaPage.getByText('Dieser Bereich ist Administratoren vorbehalten.')).toBeVisible();
  await other.close();
});

test('Falsches Passwort zeigt eine neutrale Meldung', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(`niemand-${run}@example.de`);
  await page.getByLabel('Passwort').fill('falsches-passwort-123');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.locator('p.alert')).toHaveText('E-Mail oder Passwort ist falsch.');
});
