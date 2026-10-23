import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `W${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Seiteninhalt' });
}

async function newPage(page: Page, title: string, lines: string[]) {
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await expect(page.getByRole('heading', { name: 'Neue Seite' })).toBeVisible();
  await page.getByLabel('Titel').fill(title);
  await editor(page).click();
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test('Space anlegen, Seite schreiben, bearbeiten, verschieben und Version zurückholen', async ({ page }) => {
  // S6: kein Skript darf laufen und keine CSP-Verletzung auftreten
  const cspViolations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
  });
  page.on('dialog', async (dialog) => {
    if (dialog.message().includes('xss')) throw new Error('Eingeschleustes Skript wurde ausgeführt');
    await dialog.accept();
  });

  await acceptInviteAndSetup2fa(page, createAdminViaCli(`autor-${run}@example.de`));

  // Space anlegen: führt direkt auf die Startseite
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Wissen');
  await page.getByLabel('Beschreibung').fill('Gesammeltes Wissen');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wissen' })).toBeVisible();
  await expect(page.locator('.rich')).toContainText('Gesammeltes Wissen');

  // Seite mit Überschrift, Formatierung, Infobox und Tabelle anlegen
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill('Anleitung');
  await editor(page).click();
  await page.getByRole('button', { name: 'Überschrift 2' }).click();
  await page.keyboard.type('Schritte');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Fett' }).click();
  await page.keyboard.type('Wichtig');
  await page.getByRole('button', { name: 'Fett' }).click();
  await page.keyboard.type(' ist der erste Schritt.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('<img src=x onerror=alert("xss")><script>alert("xss")</script>');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Tabelle einfügen' }).click();
  await page.keyboard.type('Spalte A');
  // Hinter der Tabelle hält der Editor immer einen leeren Absatz bereit
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Vorsicht beim Löschen');
  await page.getByRole('button', { name: 'Warnbox' }).click();
  await page.getByRole('button', { name: 'Seite anlegen' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Anleitung' })).toBeVisible();
  const content = page.locator('.rich');
  await expect(content.getByRole('heading', { level: 2, name: 'Schritte' })).toBeVisible();
  await expect(content.locator('strong')).toHaveText('Wichtig');
  await expect(content.getByRole('note', { name: 'Warnung' })).toContainText('Vorsicht beim Löschen');
  await expect(content.getByRole('cell', { name: 'Spalte A' })).toBeVisible();
  // HTML aus der Eingabe bleibt sichtbarer Text
  await expect(content).toContainText('<script>alert("xss")</script>');
  await expect(content.locator('img, script')).toHaveCount(0);
  await expect(page.getByText('Version 1 ·')).toBeVisible();
  const anleitungUrl = page.url();

  // Bearbeiten erzeugt Version 2
  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  await editor(page).getByText('ist der erste Schritt.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Danach kommt Schritt zwei.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Version 2 ·')).toBeVisible();
  await expect(content).toContainText('Danach kommt Schritt zwei.');

  // Zweite Seite auf derselben Ebene
  await page.getByRole('link', { name: 'Wissen', exact: true }).first().click();
  await newPage(page, 'Server', ['Alles über die Server.']);

  // Verschieben über den Dialog: Anleitung unter Server
  await page.goto(anleitungUrl);
  await page.getByRole('button', { name: 'Verschieben' }).click();
  const serverId = await page.locator('#move-parent option', { hasText: 'Server' }).getAttribute('value');
  await page.getByLabel('Neue übergeordnete Seite').selectOption(serverId!);
  await page.getByRole('button', { name: 'Hierher verschieben' }).click();
  const breadcrumbs = page.getByRole('navigation', { name: 'Brotkrumen' });
  await expect(breadcrumbs).toContainText('Wissen / Server');
  await expect(page.getByRole('treeitem', { name: /Server/ }).getByRole('treeitem', { name: /Anleitung/ })).toBeVisible();

  // Verschieben per Drag-and-drop zurück unter die Startseite
  const home = page.getByTestId('tree-Wissen');
  const box = await home.boundingBox();
  await page.getByTestId('tree-Anleitung').dragTo(home, { targetPosition: { x: 40, y: box!.height / 2 } });
  await expect(breadcrumbs).not.toContainText('Server', { timeout: 10_000 });
  await page.reload();
  await expect(breadcrumbs).toHaveText(`${spaceKey} / Wissen`);

  // Verlauf: vergleichen und Version 1 zurückholen
  await page.getByRole('link', { name: 'Verlauf' }).click();
  await expect(page.getByRole('heading', { name: 'Verlauf: Anleitung' })).toBeVisible();
  await page.getByRole('button', { name: 'Vergleichen' }).click();
  const diff = page.getByTestId('diff');
  await expect(diff.locator('.diff-removed')).toContainText('Wichtig ist der erste Schritt.');
  await expect(diff.locator('.diff-added')).toContainText('Danach kommt Schritt zwei.');

  await page
    .locator('tr', { has: page.getByRole('radio', { name: 'Von Version 1' }) })
    .getByRole('button', { name: 'Wiederherstellen' })
    .click();
  await expect(page.getByText('Version 3 ·')).toBeVisible();
  await expect(content).not.toContainText('Danach kommt Schritt zwei.');
  await expect(content).toContainText('Wichtig ist der erste Schritt.');

  expect(cspViolations).toEqual([]);
});

test('Seiten senden eine Content-Security-Policy mit Nonce (S6)', async ({ page }) => {
  const response = await page.goto('/login');
  const csp = response!.headers()['content-security-policy'];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-eval');
  const nonce = csp.match(/'nonce-([^']+)'/)![1];
  // Next.js versieht seine Skripte mit derselben Nonce, sonst würde die Seite nicht laufen
  const scripts = await page.locator('script').evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((n) => n === nonce)).toBe(true);
  await expect(page.getByRole('button', { name: 'Weiter' })).toBeVisible();
});
