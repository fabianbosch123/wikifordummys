import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `L${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

async function boxes(page: Page) {
  const sidebar = (await page.locator('.sidebar').boundingBox())!;
  const content = (await page.locator('.space-layout > :last-child').boundingBox())!;
  return { sidebar, content };
}

test('Layout nutzt die Bildschirmbreite, Navigation bleibt bei etwa 20 %', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`layout-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Breite');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Breite' })).toBeVisible();

  for (const view of ['Ansicht', 'Bearbeiten']) {
    if (view === 'Bearbeiten') {
      await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Seiteninhalt' })).toBeVisible();
    }
    for (const width of [1920, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const { sidebar, content } = await boxes(page);
      // Navigation links, höchstens gut 20 % der Breite
      expect(sidebar.x, view).toBeLessThan(40);
      expect(sidebar.width, view).toBeLessThanOrEqual(width * 0.2 + 1);
      // Inhalt reicht fast bis an den rechten Rand
      expect(content.x + content.width, view).toBeGreaterThan(width - 40);
    }
  }

  // Schmaler Bildschirm: Navigation über dem Inhalt, beide in voller Breite
  await page.setViewportSize({ width: 600, height: 900 });
  const { sidebar, content } = await boxes(page);
  expect(content.y).toBeGreaterThan(sidebar.y + sidebar.height - 1);
  expect(Math.abs(content.width - sidebar.width)).toBeLessThan(2);
});

test('Anhänge stehen rechts in einem aufklappbaren Panel', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`panel-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(`${spaceKey}P`);
  await page.getByLabel('Name', { exact: true }).fill('Panel');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Panel' })).toBeVisible();

  const panel = page.getByRole('complementary', { name: 'Anhänge' });
  const toggle = panel.locator('summary');
  await expect(toggle).toHaveText('Anhänge (0)');
  await page.getByTestId('attachment-input').setInputFiles([{ name: 'liste.txt', mimeType: 'text/plain', buffer: Buffer.from('eins') }]);
  await expect(toggle).toHaveText('Anhänge (1)');
  await expect(panel.getByRole('link', { name: 'liste.txt' })).toBeVisible();

  // Offen: Panel rechts neben dem Inhalt, bündig mit dem rechten Rand
  const content = page.locator('.page-body > .rich');
  const article = (await page.locator('.space-layout > :last-child').boundingBox())!;
  let text = (await content.boundingBox())!;
  let box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThan(text.x + text.width - 1);
  expect(box.x + box.width).toBeGreaterThan(article.x + article.width - 2);
  const openWidth = text.width;

  // Zugeklappt: Liste weg, der Inhalt wird breiter, der Zustand bleibt nach dem Neuladen
  await toggle.click();
  await expect(panel.getByRole('link', { name: 'liste.txt' })).toBeHidden();
  text = (await content.boundingBox())!;
  expect(text.width).toBeGreaterThan(openWidth + 100);
  await page.reload();
  await expect(toggle).toHaveText('Anhänge (1)');
  await expect(panel.getByRole('link', { name: 'liste.txt' })).toBeHidden();
  await toggle.click();
  await expect(panel.getByRole('link', { name: 'liste.txt' })).toBeVisible();

  // Schmaler Bildschirm: Panel unter dem Inhalt
  await page.setViewportSize({ width: 700, height: 900 });
  text = (await content.boundingBox())!;
  box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThan(text.y + text.height - 1);
});
