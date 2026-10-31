import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, nextCode, run } from '../helpers';

/**
 * Funde aus dem zweiten Rundgang von DerNörgelndeUser (2026-10-31): N-1, N-2, N-3, N-4, N-6.
 * N-5 (HeadlessChrome) prüft der Unit-Test in apps/api/src/common/user-agent.spec.ts.
 * Space-Schlüssel mit eigenem Präfix N, damit er nicht mit anderen Testdateien kollidiert.
 */
const spaceKey = `N${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** Merkt sich Rückfragen und beantwortet sie mit OK, solange answer nicht auf false steht */
function dialogs(page: Page) {
  const state = { messages: [] as string[], answer: true };
  page.on('dialog', (dialog) => {
    state.messages.push(dialog.message());
    void (state.answer ? dialog.accept() : dialog.dismiss());
  });
  return state;
}

test('Space-Einstellungen: Space-Admin und Archivieren nur nach Rückfrage', async ({ page }) => {
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`runde2-${run}@example.de`));
  const asked = dialogs(page);
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Runde zwei');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Runde zwei' })).toBeVisible();

  await page.goto(`/spaces/${spaceKey}/settings`);
  const everyone = page.getByLabel('Rolle für Gruppe alle-benutzer');
  await expect(everyone).toHaveValue('editor');

  // N-2: Reihenfolge von wenig zu viel Recht
  expect((await everyone.locator('option').allTextContents()).map((t) => t.trim())).toEqual(['Leser', 'Bearbeiter', 'Space-Admin']);

  // N-2: abgebrochen → nichts gespeichert, Auswahl bleibt auf Bearbeiter
  asked.answer = false;
  await everyone.selectOption('admin');
  expect(asked.messages.at(-1)).toContain('JEDES aktive Konto');
  expect(asked.messages.at(-1)).toContain('Space-Admin von „Runde zwei“');
  await expect(everyone).toHaveValue('editor');
  await expect(page.getByText(/Gespeichert:/)).toHaveCount(0);
  await page.reload();
  await expect(everyone).toHaveValue('editor');

  // Herabstufen braucht keine Rückfrage
  const before = asked.messages.length;
  await everyone.selectOption('viewer');
  await expect(page.getByText('Gespeichert: Gruppe alle-benutzer ist jetzt Leser.')).toBeVisible();
  expect(asked.messages.length).toBe(before);

  // Bestätigt → gespeichert
  asked.answer = true;
  await everyone.selectOption('admin');
  await expect(page.getByText('Gespeichert: Gruppe alle-benutzer ist jetzt Space-Admin.')).toBeVisible();
  await everyone.selectOption('editor');
  await expect(page.getByText('Gespeichert: Gruppe alle-benutzer ist jetzt Bearbeiter.')).toBeVisible();

  // N-2: Hinzufügen mit Rolle Space-Admin fragt ebenfalls nach; abgebrochen bleibt die Auswahl stehen
  const picker = page.getByLabel('Gruppe oder Person', { exact: true });
  await picker.selectOption({ label: 'administratoren' });
  await page.getByLabel('Rolle für neuen Eintrag').selectOption('admin');
  asked.answer = false;
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  expect(asked.messages.at(-1)).toContain('Gruppe administratoren wirklich zum Space-Admin');
  await expect(page.getByLabel('Rolle für Gruppe administratoren')).toHaveCount(0);
  expect(await picker.locator('option:checked').textContent()).toBe('administratoren');

  // N-1: Archivieren mit Rückfrage und Folgen; abgebrochen bleibt der Space aktiv
  await page.getByRole('button', { name: 'Space archivieren' }).click();
  expect(asked.messages.at(-1)).toContain('Space „Runde zwei“ archivieren?');
  expect(asked.messages.at(-1)).toContain('kann niemand mehr Seiten anlegen');
  await expect(page.getByRole('button', { name: 'Space archivieren' })).toBeVisible();
  await expect(page.getByText(/Der Space ist archiviert/)).toHaveCount(0);

  asked.answer = true;
  await page.getByRole('button', { name: 'Space archivieren' }).click();
  await expect(page.getByText(/Der Space ist archiviert/)).toBeVisible();
  // Aufheben ohne Rückfrage
  const count = asked.messages.length;
  await page.getByRole('button', { name: 'Archivierung aufheben' }).click();
  await expect(page.getByText('Der Space ist wieder aktiv.')).toBeVisible();
  expect(asked.messages.length).toBe(count);

  // N-6: Boxen und Tabelle haben Text neben dem Symbol
  await page.goto(`/spaces/${spaceKey}`);
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  for (const name of ['Infobox', 'Warnbox', 'Erfolgsbox', 'Notizbox']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveText(new RegExp(`${name}$`));
  }
  await expect(page.getByRole('button', { name: 'Tabelle einfügen' })).toHaveText(/Tabelle$/);
  await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveText(/Link$/);
});

test('Profil: Token-Bereich auch bei ausgeschaltetem MCP, Token und Befehl kopieren', async ({ page }) => {
  const secret = await acceptInviteAndSetup2fa(page, createAdminViaCli(`runde2-token-${run}@example.de`));
  const tokens = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Claude und andere KI-Assistenten (MCP)' }) });

  // N-4: MCP ausschalten (kann von einem früheren Lauf an sein); der Bereich bleibt mit Hinweis sichtbar
  await page.goto('/admin/api');
  await expect(page.getByRole('button', { name: /^MCP-Server (ein|aus)schalten$/ })).toBeVisible();
  const off = page.getByRole('button', { name: 'MCP-Server ausschalten' });
  if (await off.isVisible()) await off.click();
  await expect(page.getByRole('button', { name: 'MCP-Server einschalten' })).toBeVisible();

  await page.goto('/profile');
  await expect(tokens.getByText('Der MCP-Zugang ist ausgeschaltet')).toBeVisible();
  await expect(tokens.getByRole('button', { name: 'Token anlegen' })).toHaveCount(0);
  await tokens.getByRole('link', { name: 'Administration → Claude (MCP)' }).click();
  await expect(page).toHaveURL(/\/admin\/api$/);

  // N-3: eingeschaltet Token anlegen und beide Felder kopieren
  await page.getByRole('button', { name: 'MCP-Server einschalten' }).click();
  await expect(page.getByRole('button', { name: 'MCP-Server ausschalten' })).toBeVisible();
  await page.goto('/profile');
  await expect(tokens.getByText('Der MCP-Zugang ist ausgeschaltet')).toHaveCount(0);
  await tokens.getByLabel('Name', { exact: true }).fill('Kopiertest');
  await tokens.getByLabel('Code aus der App').fill(nextCode(secret));
  await tokens.getByRole('button', { name: 'Token anlegen' }).click();
  const token = await tokens.getByLabel('Token', { exact: true }).inputValue();
  expect(token).toMatch(/^wfd_/);

  await tokens.getByRole('button', { name: 'Token kopieren' }).click();
  await expect(tokens.getByText('Kopiert.')).toBeVisible();
  expect(await clipboard(page)).toBe(token);

  await tokens.getByRole('button', { name: 'Befehl kopieren' }).click();
  expect(await clipboard(page)).toBe(await tokens.getByLabel('Für Claude Code').inputValue());
  expect(await clipboard(page)).toContain(`Bearer ${token}`);
});
