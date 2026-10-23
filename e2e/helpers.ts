import { expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { authenticator } from 'otplib';
import { e2eEnv } from './env';

export const PASSWORD = 'ein-sehr-sicheres-passwort';
export const run = Date.now().toString(36);

export function createAdminViaCli(email: string): string {
  const out = execFileSync('node', ['../apps/api/dist/cli.js', 'create-admin', '--email', email, '--name', 'Erste Admin', '--invite'], {
    env: { ...process.env, ...e2eEnv },
    encoding: 'utf8',
  });
  const match = out.match(/(http:\/\/\S+\/invite\/\S+)/);
  if (!match) throw new Error(`Kein Einladungslink in: ${out}`);
  return match[1];
}

/** Legt einen Admin mit Startpasswort an und liest das Passwort aus der Ausgabe */
export function createAdminWithPassword(email: string): string {
  const out = execFileSync('node', ['../apps/api/dist/cli.js', 'create-admin', '--email', email, '--name', 'Shell Admin'], {
    env: { ...process.env, ...e2eEnv },
    encoding: 'utf8',
  });
  const match = out.match(/^ {2}Passwort: +(\S+)$/m);
  if (!match) throw new Error(`Kein Startpasswort in: ${out}`);
  return match[1];
}

/** Erzeugt einen Code für den nächsten Zeitschritt, damit er sich vom zuletzt verwendeten unterscheidet */
export function nextCode(secret: string): string {
  return authenticator.clone({ epoch: Date.now() + 30_000 }).generate(secret);
}

export async function acceptInviteAndSetup2fa(page: Page, inviteUrl: string): Promise<string> {
  await page.goto(inviteUrl.replace(e2eEnv.APP_ORIGIN, ''));
  await expect(page.getByRole('heading', { name: 'Einladung annehmen' })).toBeVisible();
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await page.getByRole('button', { name: 'Konto anlegen' }).click();

  await expect(page).toHaveURL(/\/setup-2fa$/);
  await expect(page.getByAltText('QR-Code für die Authenticator-App')).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('6-stelliger Code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Bestätigen' }).click();

  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await page.getByLabel('Ich habe die Codes gesichert.').check();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('heading', { name: /^Willkommen/ })).toBeVisible();
  return secret;
}
