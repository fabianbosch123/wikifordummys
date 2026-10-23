import { expect, Locator, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `D${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

/** Kleinstes gültiges PNG (1×1 Pixel) */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface TestFile {
  name: string;
  type: string;
  base64: string;
}

const text = (s: string) => Buffer.from(s).toString('base64');

/** Zieht Dateien wie aus dem Dateimanager auf die Mitte des Elements oder fügt sie wie aus der Zwischenablage ein */
async function transfer(target: Locator, kind: 'drop' | 'paste', files: TestFile[]) {
  await target.evaluate(
    (el, { kind, files }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      if (kind === 'paste') {
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        return;
      }
      const r = el.getBoundingClientRect();
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, dataTransfer: dt };
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, at));
    },
    { kind, files },
  );
}

test('Bilder und Dateien lassen sich per Drag & Drop und aus der Zwischenablage einfügen', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`ziehen-${run}@example.de`));

  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Ablage');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ablage' })).toBeVisible();

  // Neue Seite: Dateien erscheinen sofort, hochgeladen wird beim Anlegen
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill('Mitgebracht');
  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });
  await editor.click();
  await page.keyboard.type('Unterlagen zum Treffen');
  await transfer(editor, 'drop', [
    { name: 'plan.png', type: 'image/png', base64: PNG },
    { name: 'protokoll.txt', type: 'text/plain', base64: text('Punkt 1: Kaffee') },
  ]);
  await expect(editor.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(editor.getByRole('link', { name: '📎 protokoll.txt' })).toBeVisible();
  await expect(page.getByText('Eingefügte Dateien werden beim Anlegen der Seite als Anhang hochgeladen.')).toBeVisible();
  await page.getByRole('button', { name: 'Seite anlegen' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Mitgebracht' })).toBeVisible();
  const content = page.locator('article .rich');
  await expect(content.locator('img')).toHaveAttribute('src', /^\/api\/v1\/attachments\//);
  await expect(content.locator('img')).toHaveJSProperty('naturalWidth', 1);
  const fileLink = content.getByRole('link', { name: '📎 protokoll.txt' });
  await expect(fileLink).toHaveAttribute('href', /^\/api\/v1\/attachments\//);
  expect(await (await page.request.get((await fileLink.getAttribute('href'))!)).text()).toBe('Punkt 1: Kaffee');
  const attachments = page.locator('.attachment-list');
  await expect(attachments.getByRole('link', { name: 'plan.png' })).toBeVisible();
  await expect(attachments.getByRole('link', { name: 'protokoll.txt' })).toBeVisible();
  expect(dialogs).toEqual([]);

  // Bestehende Seite: Bild aus der Zwischenablage wird sofort hochgeladen
  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  await editor.getByText('Unterlagen zum Treffen').click();
  await page.keyboard.press('End');
  await transfer(editor, 'paste', [{ name: 'bildschirmfoto.png', type: 'image/png', base64: PNG }]);
  await expect(editor.locator('img')).toHaveCount(2);
  await expect(editor.locator('img').nth(0)).toHaveAttribute('src', /^\/api\/v1\/attachments\//);
  await expect(editor.locator('img').nth(1)).toHaveAttribute('src', /^\/api\/v1\/attachments\//);

  // Fehler beim Hochladen: verständliche Meldung, der Platzhalter verschwindet wieder
  await transfer(editor, 'drop', [{ name: 'leer.pdf', type: 'application/pdf', base64: '' }]);
  await expect.poll(() => dialogs).toEqual(['„leer.pdf“ wurde nicht eingefügt: Die Datei ist leer.']);
  await expect(editor.getByRole('link', { name: '📎 leer.pdf' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mitgebracht' })).toBeVisible();
  await expect(content.locator('img')).toHaveCount(2);
  await expect(attachments.getByRole('link', { name: 'bildschirmfoto.png' })).toBeVisible();
});
