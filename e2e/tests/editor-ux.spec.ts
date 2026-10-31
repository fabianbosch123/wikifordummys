import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

/** Funde aus dem Rundgang von DerNörgelndeUser (2026-10-31) rund um Editor und Seitenlayout */

const spaceKey = `U${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

async function setup(page: Page, name: string) {
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`ux-${name}-${run}@example.de`));
  const key = `${spaceKey}${name.slice(0, 1).toUpperCase()}`;
  await page.getByLabel('Schlüssel').fill(key);
  await page.getByLabel('Name', { exact: true }).fill(`UX ${name}`);
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `UX ${name}` })).toBeVisible();
  return key;
}

async function newPage(page: Page, title: string) {
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test('N-1/N-2: Rückfrage bei Links in der App, Entwurf im Browser, Hinweis bei abgelaufener Sitzung', async ({ page, context }) => {
  await setup(page, 'nav');
  await newPage(page, 'Zweite Seite');
  await page.locator('.space-name').click();
  await expect(page.getByRole('heading', { level: 1, name: 'UX nav' })).toBeVisible();
  const viewUrl = page.url();

  await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });
  await editor.click();
  await page.keyboard.type('Zehn Minuten Arbeit');
  const editUrl = page.url();

  // Abgelehnt: Klick auf eine andere Seite im Baum, auf „Start“ und eine Suche bleiben ohne Wirkung
  const dialogs: string[] = [];
  let answer = false;
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void (answer ? dialog.accept() : dialog.dismiss());
  });
  await page.getByTestId('tree-Zweite Seite').getByRole('link').click();
  await page.getByRole('link', { name: 'Start' }).click();
  await page.locator('#topbar-search').fill('Arbeit');
  await page.locator('#topbar-search').press('Enter');
  await expect.poll(() => dialogs.length).toBe(3);
  expect(dialogs.every((m) => m.startsWith('Seite verlassen? Deine Änderungen sind noch nicht gespeichert.'))).toBe(true);
  expect(page.url()).toBe(editUrl);
  await expect(editor).toContainText('Zehn Minuten Arbeit');
  await expect(page.getByText('Ungespeicherte Änderungen', { exact: true })).toBeVisible();

  // Bestätigt: der Wechsel findet statt, der Entwurf bleibt im Tab gespeichert
  answer = true;
  await page.getByTestId('tree-Zweite Seite').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Zweite Seite' })).toBeVisible();
  await page.goto(editUrl);
  await expect(page.getByText(/Es gibt einen ungespeicherten Entwurf/)).toBeVisible();
  await page.getByRole('button', { name: 'Entwurf wiederherstellen' }).click();
  await expect(editor).toContainText('Zehn Minuten Arbeit');

  // Sitzung läuft ab: klarer Hinweis mit Link zum Anmelden in neuem Tab, der Text bleibt
  const cookies = await context.cookies();
  await context.clearCookies();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  const expired = page.locator('.session-expired');
  await expect(expired).toContainText('Deine Sitzung ist abgelaufen.');
  const login = expired.getByRole('link', { name: 'In neuem Tab anmelden' });
  await expect(login).toHaveAttribute('target', '_blank');
  await expect(login).toHaveAttribute('href', '/login');
  await expect(editor).toContainText('Zehn Minuten Arbeit');

  // Wieder angemeldet (hier: Cookies zurück) speichert derselbe Knopf, und der Entwurf ist weg
  await context.addCookies(cookies);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page).toHaveURL(viewUrl);
  await expect(page.locator('article .rich')).toContainText('Zehn Minuten Arbeit');
  await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByText(/Es gibt einen ungespeicherten Entwurf/)).toHaveCount(0);

  // Ohne Änderungen fragt nichts nach
  const before = dialogs.length;
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(editor).toBeHidden();
  expect(dialogs.length).toBe(before);

  // Abmelden mit offenen Änderungen: nach der Rückfrage bleibt kein Entwurf im Tab zurück
  await page.goto(editUrl);
  await editor.click();
  await page.keyboard.type(' Vertraulich');
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('wiki.draft.')).length)).toBe(1);
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('wiki.draft.')))).toEqual([]);
});

test('N-7: Verschieben und Einschränkungen schließen mit Escape, nehmen den Fokus, nur eins ist offen', async ({ page }) => {
  await setup(page, 'panel');
  await newPage(page, 'Unterseite');

  const move = page.getByRole('button', { name: 'Verschieben' });
  await move.click();
  const moveDialog = page.getByRole('dialog', { name: 'Verschieben' });
  await expect(moveDialog).toBeVisible();
  await expect(page.locator('#move-parent')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(moveDialog).toHaveCount(0);
  await expect(move).toBeFocused();

  await move.click();
  await expect(moveDialog).toBeVisible();
  await page.getByRole('button', { name: 'Einschränkungen', exact: true }).click();
  const restrictDialog = page.getByRole('dialog', { name: 'Einschränkungen' });
  await expect(restrictDialog).toBeVisible();
  await expect(moveDialog).toHaveCount(0);
  await expect(restrictDialog.locator('select').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Einschränkungen', exact: true })).toBeFocused();
});

test('N-8/N-19: Link und Bild über Formulare im Editor, Knopf Unterstrichen, Kürzel in Tooltips', async ({ page }) => {
  await setup(page, 'tools');
  const popups: string[] = [];
  page.on('dialog', (dialog) => {
    popups.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });
  await editor.click();
  await page.keyboard.type('Hallo Welt');

  // Tooltips nennen die Kürzel aus hotkeys.ts
  await expect(page.getByRole('button', { name: 'Fett', exact: true })).toHaveAttribute('title', 'Fett (Strg+B)');
  await expect(page.getByRole('button', { name: 'Überschrift 2' })).toHaveAttribute('title', 'Überschrift 2 (Strg+Alt+2)');
  const underline = page.getByRole('button', { name: 'Unterstrichen' });
  await expect(underline).toHaveAttribute('title', 'Unterstrichen (Strg+U)');

  // Unterstreichen per Knopf
  await page.keyboard.press('Shift+Home');
  await underline.click();
  await expect(editor.locator('u')).toHaveText('Hallo Welt');
  await expect(underline).toHaveAttribute('aria-pressed', 'true');

  // Link: Prüfung beim Tippen, Übernehmen mit Enter
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  const linkPanel = page.getByRole('group', { name: 'Link einfügen' });
  const url = linkPanel.getByLabel('Adresse des Links');
  await expect(url).toBeFocused();
  await url.fill('javascript:alert(1)');
  await expect(linkPanel).toContainText('Diese Adresse ist nicht erlaubt.');
  await expect(linkPanel.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  await url.fill('https://example.de/handbuch');
  await expect(linkPanel).toContainText('Externe Seite: example.de');
  await url.press('Enter');
  await expect(linkPanel).toHaveCount(0);
  await expect(editor.locator('a[href="https://example.de/handbuch"]')).toHaveText('Hallo Welt');
  // Enter im Formular speichert nicht die Seite
  await expect(page).toHaveURL(/\/edit$/);

  // Bestehenden Link entfernen
  await editor.locator('a').click();
  await page.getByRole('button', { name: 'Link bearbeiten' }).click();
  const editPanel = page.getByRole('group', { name: 'Link bearbeiten' });
  await expect(editPanel.getByLabel('Adresse des Links')).toHaveValue('https://example.de/handbuch');
  await editPanel.getByRole('button', { name: 'Link entfernen' }).click();
  await expect(editor.locator('a')).toHaveCount(0);

  // Escape schließt das Formular, ohne etwas zu ändern
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Link einfügen' })).toHaveCount(0);

  // Ohne Auswahl: angezeigter Text plus Adresse
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByLabel('Adresse des Links').fill('/pages/irgendwo');
  await expect(page.getByRole('group', { name: 'Link einfügen' })).toContainText('Verweis innerhalb des Wikis');
  await page.getByLabel('Angezeigter Text').fill('Wiki-Seite');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(editor.locator('a[href="/pages/irgendwo"]')).toHaveText('Wiki-Seite');

  // Bild über Adresse: nur https
  await page.getByRole('button', { name: 'Bild über Adresse einbinden' }).click();
  const imagePanel = page.getByRole('group', { name: 'Bild über Adresse einbinden' });
  await imagePanel.getByLabel('Adresse des Bildes').fill('http://example.de/bild.png');
  await expect(imagePanel).toContainText('Bilder sind nur über https:// erlaubt.');
  await expect(imagePanel.getByRole('button', { name: 'Einfügen' })).toBeDisabled();
  await imagePanel.getByLabel('Adresse des Bildes').fill('https://example.invalid/bild.png');
  await imagePanel.getByLabel('Kurze Beschreibung (für Screenreader)').fill('Testbild');
  await imagePanel.getByRole('button', { name: 'Einfügen' }).click();
  await expect(editor.locator('img[src="https://example.invalid/bild.png"]')).toHaveAttribute('alt', 'Testbild');

  expect(popups).toEqual([]);
});

test('N-11/N-18: Handy mit einklappbarem Seitenbaum und fester Speichern-Leiste, Titelzähler, kurze Baumeinträge', async ({ page }) => {
  await setup(page, 'mobil');
  const longTitle = `Sehr langer Titel ${'mit vielen Wörtern '.repeat(12)}`.trim().slice(0, 190).trim();
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  const title = page.getByLabel('Titel');
  await expect(page.getByText('0 / 200 Zeichen')).toBeVisible();
  await title.fill(longTitle);
  await expect(page.locator('#page-title-count')).toHaveText(`${longTitle.length} / 200 Zeichen`);
  await expect(page.locator('#page-title-count')).toHaveClass(/warn/);
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: longTitle })).toBeVisible();

  // Baum kürzt nach zwei Zeilen, der volle Titel steht im Tooltip
  const treeLink = page.getByRole('tree', { name: 'Seitenbaum' }).getByRole('link', { name: longTitle });
  await expect(treeLink).toHaveAttribute('title', longTitle);
  const lineHeight = await treeLink.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 20);
  expect((await treeLink.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 2 + 2);

  // Schmaler Bildschirm: Baum zugeklappt, Inhalt zuerst
  await page.setViewportSize({ width: 390, height: 800 });
  const toggle = page.getByRole('button', { name: 'Seitenbaum zeigen' });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Seitenbaum' })).toBeHidden();
  await toggle.click();
  await expect(page.getByRole('tree', { name: 'Seitenbaum' })).toBeVisible();
  await page.getByRole('button', { name: 'Seitenbaum ausblenden' }).click();
  await expect(page.getByRole('tree', { name: 'Seitenbaum' })).toBeHidden();

  // Speichern bleibt auch bei langem Text im Bild
  await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });
  await editor.click();
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter');
  await page.keyboard.type('Ende');
  const save = page.getByRole('button', { name: 'Speichern', exact: true });
  await expect(save).toBeInViewport();
  const box = (await save.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(800);

  // Breit: Knopf zum Einklappen gibt es nicht, der Baum ist immer da
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('button', { name: /Seitenbaum (zeigen|ausblenden)/ })).toBeHidden();
  await expect(page.getByRole('tree', { name: 'Seitenbaum' })).toBeVisible();
});
