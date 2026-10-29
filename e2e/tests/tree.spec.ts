import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `T${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

async function newChild(page: Page, title: string) {
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test('Klick auf eine Seite im Seitenbaum klappt ihre Unterseiten auf und zu', async ({ page }) => {
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`tree-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Baum');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Baum' })).toBeVisible();
  await newChild(page, 'Kapitel');
  await newChild(page, 'Abschnitt');

  const tree = page.getByRole('tree', { name: 'Seitenbaum' });
  const kapitel = tree.getByRole('link', { name: 'Kapitel', exact: true });
  const abschnitt = tree.getByRole('link', { name: 'Abschnitt', exact: true });
  // Auf der Unterseite ist die Elternseite aufgeklappt
  await expect(abschnitt).toBeVisible();

  // Klick öffnet die Seite und klappt zu, der Zustand bleibt nach dem Seitenwechsel erhalten
  await kapitel.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kapitel' })).toBeVisible();
  await expect(abschnitt).toBeHidden();

  // Nochmal klicken klappt wieder auf
  await kapitel.click();
  await expect(abschnitt).toBeVisible();

  // Der Pfeil funktioniert weiterhin
  await tree.getByRole('button', { name: 'Kapitel zuklappen' }).click();
  await expect(abschnitt).toBeHidden();

  // Tastatur: Enter auf dem Link klappt auf
  await kapitel.focus();
  await page.keyboard.press('Enter');
  await expect(abschnitt).toBeVisible();

  // Gemerkt für die Sitzung, auch nach dem Neuladen
  await kapitel.click();
  await expect(abschnitt).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Kapitel' })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: /Kapitel/ })).toHaveAttribute('aria-expanded', 'false');

  // Ctrl-Klick öffnet einen neuen Tab und klappt nicht um
  const [tab] = await Promise.all([page.context().waitForEvent('page'), kapitel.click({ modifiers: ['ControlOrMeta'] })]);
  await tab.close();
  await expect(tree.getByRole('treeitem', { name: /Kapitel/ })).toHaveAttribute('aria-expanded', 'false');
});
