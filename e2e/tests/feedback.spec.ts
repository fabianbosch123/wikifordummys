import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

/**
 * Funde aus dem Rundgang von DerNörgelndeUser (2026-10-31): N-3, N-4, N-5, N-6, N-10, N-12, N-13, N-14.
 * Space-Schlüssel mit eigenem Präfix U, damit er nicht mit anderen Testdateien kollidiert.
 */
const spaceKey = `U${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

/** Merkt sich Rückfragen und beantwortet sie mit OK, solange answer nicht auf false steht */
function dialogs(page: Page) {
  const state = { messages: [] as string[], answer: true };
  page.on('dialog', (dialog) => {
    state.messages.push(dialog.message());
    void (state.answer ? dialog.accept() : dialog.dismiss());
  });
  return state;
}

async function newChild(page: Page, title: string, text?: string) {
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill(title);
  if (text) {
    await page.getByRole('textbox', { name: 'Seiteninhalt' }).click();
    await page.keyboard.type(text);
  }
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test('Seiten und Anhänge: leere Seite, gleiche Titel, gleiche Dateien, Suche und Löschen mit Rückgängig', async ({ page }) => {
  const asked = dialogs(page);
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`feedback-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Rückmeldungen');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rückmeldungen' })).toBeVisible();

  // N-13: Die leere Startseite erklärt, wie es weitergeht
  const empty = page.getByTestId('empty-page');
  await expect(empty).toContainText('Diese Seite ist noch leer.');
  await expect(empty.getByRole('link', { name: 'Inhalt schreiben (E)' })).toHaveAttribute('href', /\/edit$/);
  await empty.getByRole('link', { name: '+ Unterseite anlegen' }).click();
  await page.getByLabel('Titel').fill('Team');
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();

  // N-4: Gleicher Titel unter derselben Seite wird angemerkt und muss bestätigt werden
  await newChild(page, 'Drucker Anleitung', 'Toner im Keller wechseln.');
  await page.getByRole('tree', { name: 'Seitenbaum' }).getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill('drucker anleitung ');
  await expect(page.getByText('Unter derselben Seite gibt es schon eine Seite mit diesem Titel.')).toBeVisible();
  await page.getByLabel('Titel').fill('Drucker Anleitung');
  await page.getByRole('textbox', { name: 'Seiteninhalt' }).click();
  await page.keyboard.type('Toner im Büro wechseln.');
  asked.answer = false;
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  expect(asked.messages.at(-1)).toContain('gibt es schon eine Seite „Drucker Anleitung“');
  await expect(page.getByRole('heading', { level: 1, name: 'Neue Seite' })).toBeVisible();
  asked.answer = true;
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Drucker Anleitung' })).toBeVisible();

  // In Auswahllisten stehen gleiche Titel mit Pfad und Nummer
  await page.getByRole('tree', { name: 'Seitenbaum' }).getByRole('link', { name: 'Team', exact: true }).click();
  await newChild(page, 'Notizen');
  await page.getByRole('button', { name: 'Verschieben' }).click();
  const options = page.locator('#move-parent option', { hasText: 'Drucker Anleitung' });
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveText(/Drucker Anleitung – Rückmeldungen › Team$/);
  await expect(options.nth(1)).toHaveText(/Drucker Anleitung – Rückmeldungen › Team \(2\)$/);
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  // N-5: Dieselbe Datei noch einmal wird auf Wunsch eine neue Fassung oder bekommt einen eigenen Namen
  const attachments = page.locator('.attachment-list');
  const input = page.getByTestId('attachment-input');
  await input.setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('erste Fassung') });
  await expect(attachments.getByRole('link', { name: 'notiz.txt' })).toBeVisible();
  await input.setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('zweite Fassung') });
  const prompt = page.getByRole('alertdialog', { name: 'Datei gibt es schon' });
  await expect(prompt).toContainText('„notiz.txt“ hängt schon an dieser Seite');
  await prompt.getByRole('button', { name: 'Als neue Fassung speichern' }).click();
  await expect(page.getByText('„notiz.txt“ ist jetzt Fassung 2.')).toBeVisible();
  await expect(attachments.locator('li')).toHaveCount(1);
  await expect(attachments.getByText('Fassung 2', { exact: true })).toBeVisible();
  await input.setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('dritte Datei') });
  await prompt.getByRole('button', { name: 'Als eigene Datei behalten' }).click();
  await expect(attachments.getByRole('link', { name: 'notiz (2).txt' })).toBeVisible();
  await expect(prompt).toBeHidden();

  // Textdatei mit der Endung .png: kein „PNG“-Symbol, nur zum Herunterladen
  await input.setInputFiles({ name: 'getarnt.png', mimeType: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') });
  const fake = attachments.locator('li', { hasText: 'getarnt.png' });
  await expect(fake.locator('.file-icon')).toHaveText('DATEI');
  await expect(page.getByText('„getarnt.png“: Der Inhalt passt nicht zur Endung')).toBeVisible();
  const download = await page.request.get((await fake.getByRole('link', { name: 'getarnt.png' }).getAttribute('href'))!);
  expect(download.headers()['content-type']).toBe('application/octet-stream');
  expect(download.headers()['content-disposition']).toMatch(/^attachment;/);
  expect(download.headers()['x-content-type-options']).toBe('nosniff');

  // N-6: Anhänge findet die Suche über den Dateinamen, mit der Seite, an der sie hängen
  // Auf den Space beschränkt: die Testdatenbank enthält Spaces früherer Läufe
  await page.goto(`/search?q=notiz&space=${spaceKey}`);
  const found = page.getByRole('list', { name: 'Gefundene Anhänge' });
  await expect(found.getByRole('link', { name: 'notiz.txt' })).toBeVisible();
  await expect(found.getByRole('link', { name: 'notiz (2).txt' })).toBeVisible();
  await expect(found.locator('li').first()).toContainText('an der Seite Notizen');
  await expect(found.locator('li').first()).toContainText('Rückmeldungen › Team');

  // N-4/N-14: Suchtreffer zeigen den Pfad und einen lesbaren Ausschnitt
  await page.goto(`/search?q=Toner&space=${spaceKey}`);
  const results = page.getByRole('list', { name: 'Suchergebnisse' });
  await expect(results.locator('li')).toHaveCount(2);
  await expect(results.locator('.search-path').first()).toHaveText('Rückmeldungen › Team');

  // N-10: Nach dem Löschen sagt ein Hinweis, wo die Seite ist, und bietet Rückgängig an
  await results.getByRole('link', { name: 'Drucker Anleitung' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Drucker Anleitung' })).toBeVisible();
  await page.getByRole('tree', { name: 'Seitenbaum' }).getByRole('link', { name: 'Notizen', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notizen' })).toBeVisible();
  await page.locator('.page-head').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
  const notice = page.getByRole('status').filter({ hasText: 'in den Papierkorb verschoben' });
  await expect(notice).toContainText('„Notizen“ wurde samt Unterseiten in den Papierkorb verschoben.');
  await expect(notice.getByRole('link', { name: 'Papierkorb' })).toHaveAttribute('href', `/spaces/${spaceKey}/trash`);
  await expect(page.getByRole('tree', { name: 'Seitenbaum' }).getByRole('link', { name: 'Notizen', exact: true })).toHaveCount(0);
  await notice.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notizen' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Seitenbaum' }).getByRole('link', { name: 'Notizen', exact: true })).toBeVisible();
  await expect(notice).toBeHidden();
});

test('Rollen gelten sofort, Einschränkungen warnen vor dem Verwerfen, Leser kommen nicht in den Editor', async ({ page, browser }) => {
  const key = `${spaceKey.slice(0, 6)}L`;
  const asked = dialogs(page);
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`feedback-admin-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(key);
  await page.getByLabel('Name', { exact: true }).fill('Nur lesen');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nur lesen' })).toBeVisible();

  // Kollegin einladen (ohne Mailserver steht der Link da)
  await page.getByRole('link', { name: 'Administration' }).click();
  await page.getByLabel('E-Mail').fill(`leserin-${run}@example.de`);
  await page.getByLabel('Anzeigename').fill('Leserin');
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  const inviteLink = (await page.getByTestId('invite-link').textContent())!.trim();

  // N-3: Rollen gelten ohne eigenen Speichern-Knopf
  await page.goto(`/spaces/${key}/settings`);
  await expect(page.getByRole('heading', { name: 'Rollen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rollen speichern' })).toHaveCount(0);
  await page.getByLabel('Rolle für Gruppe alle-benutzer').selectOption('viewer');
  await expect(page.getByText('Gespeichert: Gruppe alle-benutzer ist jetzt Leser.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Rolle für Gruppe alle-benutzer')).toHaveValue('viewer');

  // N-3: Einschränkungen sind ein Dialog mit Speichern; Ungespeichertes wird angezeigt und beim Abbrechen nachgefragt
  await page.goto(`/spaces/${key}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Nur lesen' })).toBeVisible();
  await page.getByRole('button', { name: 'Einschränkungen' }).click();
  const viewList = page.locator('fieldset').filter({ hasText: 'Ansehen' });
  await viewList.getByLabel('Gruppe oder Person').selectOption({ label: 'Erste Admin' });
  await viewList.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('Noch nicht gespeichert')).toBeVisible();
  asked.answer = false;
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  expect(asked.messages.at(-1)).toContain('noch nicht gespeichert');
  await expect(page.getByRole('heading', { name: 'Einschränkungen' })).toBeVisible();
  asked.answer = true;
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('heading', { name: 'Einschränkungen' })).toBeHidden();
  await expect(page.getByText('🔒 Ansehen eingeschränkt')).toHaveCount(0);

  // N-12 und N-13 aus Sicht der Leserin
  const other = await browser.newContext({ locale: 'de-DE' });
  const reader = await other.newPage();
  await acceptInviteAndSetup2fa(reader, inviteLink);
  await reader.goto(`/spaces/${key}`);
  await expect(reader.getByRole('heading', { level: 1, name: 'Nur lesen' })).toBeVisible();
  await expect(reader.getByTestId('empty-page')).toContainText('Sobald jemand Inhalt einträgt, erscheint er hier.');
  await expect(reader.getByRole('link', { name: '+ Neue Seite' })).toHaveCount(0);
  await reader.goto(`/spaces/${key}/new`);
  await expect(reader.getByText('Du kannst hier keine Seiten anlegen.')).toBeVisible();
  await expect(reader.getByLabel('Titel')).toHaveCount(0);
  await other.close();
});
