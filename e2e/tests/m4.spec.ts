import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

test('Mailversand in der Administration einrichten, prüfen und wieder abschalten', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`mail-${run}@example.de`));

  await page.goto('/admin/mail');
  await expect(page.getByRole('heading', { name: 'Mailversand' })).toBeVisible();
  await expect(page.getByText('Es ist kein Mailserver eingerichtet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Testmail senden' })).toBeDisabled();

  // Nicht erreichbarer Server: Speichern mit Prüfung scheitert verständlich, nichts wird gespeichert
  await page.getByLabel('SMTP-Server').fill('127.0.0.1');
  await page.getByLabel('Verschlüsselung').selectOption('none');
  await expect(page.getByLabel('Port')).toHaveValue('25');
  await page.getByLabel('Port').fill('1');
  await page.getByLabel('Benutzername').fill('wiki');
  await page.getByLabel('Passwort').fill('geheim');
  await page.getByLabel('Absender').fill('Wiki <wiki@example.de>');
  await page.getByRole('button', { name: 'Prüfen und speichern' }).click();
  await expect(page.locator('p.alert.error')).toContainText('Verbindung');
  await page.reload();
  await expect(page.getByText('Es ist kein Mailserver eingerichtet.')).toBeVisible();

  // Ohne Prüfung speichern: Einstellungen gelten, das Passwort wird nicht angezeigt
  await page.getByLabel('SMTP-Server').fill('127.0.0.1');
  await page.getByLabel('Verschlüsselung').selectOption('none');
  await page.getByLabel('Port').fill('1');
  await page.getByLabel('Benutzername').fill('wiki');
  await page.getByLabel('Passwort').fill('geheim');
  await page.getByLabel('Absender').fill('Wiki <wiki@example.de>');
  await page.getByRole('button', { name: 'Ohne Prüfung speichern' }).click();
  await expect(page.getByText('Gespeichert (ohne Prüfung der Verbindung).')).toBeVisible();
  await expect(page.getByText(/stammen aus der Administration/)).toBeVisible();
  await expect(page.getByLabel('Passwort')).toHaveValue('');
  await expect(page.getByLabel('Passwort')).toHaveAttribute('placeholder', 'unverändert');

  // Testmail scheitert am nicht erreichbaren Server
  await page.getByRole('button', { name: 'Testmail senden' }).click();
  await expect(page.locator('p.alert.error')).toContainText('Verbindung');

  // Abschalten
  await page.getByRole('button', { name: 'Mailversand abschalten' }).click();
  await expect(page.getByText('Es ist kein Mailserver eingerichtet.')).toBeVisible();

  // Alles steht im Audit-Log
  await page.getByRole('link', { name: 'Audit-Log' }).click();
  await expect(page.getByText('admin.settings.mail.updated')).toBeVisible();
  await expect(page.getByText('admin.settings.mail.reset')).toBeVisible();
});
