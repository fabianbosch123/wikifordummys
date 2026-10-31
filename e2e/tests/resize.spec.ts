import { deflateSync } from 'node:zlib';
import { expect, Page, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `G${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

/** Einfarbiges PNG in beliebiger Größe, damit sich das Bild sichtbar ziehen lässt */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x4a)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10);
  await page.mouse.up();
}

test('Spaltenbreiten und Bildgröße lassen sich im Editor ziehen und bleiben gespeichert', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept('Diagramm'));
  await acceptInviteAndSetup2fa(page, createAdminViaCli(`groesse-${run}@example.de`));

  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Größen');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Größen' })).toBeVisible();

  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  await page.getByLabel('Titel').fill('Maße');
  await page.getByRole('textbox', { name: 'Seiteninhalt' }).click();
  await page.keyboard.type('Einleitung');
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Maße' })).toBeVisible();

  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });
  await editor.getByText('Einleitung').click();
  await page.keyboard.press('End');

  // Bild hochladen und an der rechten unteren Ecke auf etwa die halbe Breite ziehen
  await page.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'diagramm.png', mimeType: 'image/png', buffer: png(400, 200) });
  await page.getByLabel('Kurze Beschreibung (für Screenreader)').fill('Diagramm');
  await page.getByRole('button', { name: 'Einfügen', exact: true }).click();
  const editorImage = editor.locator('img');
  await expect(editorImage).toHaveJSProperty('naturalWidth', 400);
  const wrapper = editor.locator('[data-resize-wrapper]');
  await expect(wrapper).toBeVisible();
  await wrapper.hover();
  const corner = await editor.locator('[data-resize-handle="bottom-right"]').boundingBox();
  expect(corner).not.toBeNull();
  await drag(page, { x: corner!.x + corner!.width / 2, y: corner!.y + corner!.height / 2 }, -200, -100);
  await expect.poll(async () => (await editorImage.boundingBox())!.width).toBeLessThan(260);

  // Tabelle einfügen und den rechten Rand der ersten Spalte nach rechts ziehen
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: 'Tabelle einfügen' }).click();
  await page.keyboard.type('Breit');
  const firstCell = editor.locator('th').first();
  const before = (await firstCell.boundingBox())!;
  const edge = { x: before.x + before.width - 2, y: before.y + before.height / 2 };
  await page.mouse.move(edge.x - 20, edge.y);
  await page.mouse.move(edge.x, edge.y);
  // Der Ziehgriff erscheint an allen Zellen der Spalte
  await expect(editor.locator('.column-resize-handle').first()).toBeVisible();
  await drag(page, edge, 150, 0);
  await expect.poll(async () => (await firstCell.boundingBox())!.width).toBeGreaterThan(before.width + 100);

  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Maße' })).toBeVisible();

  // Ansicht übernimmt die gespeicherten Maße
  const image = page.locator('article .rich img');
  await expect(image).toHaveJSProperty('naturalWidth', 400);
  const width = Number(await image.getAttribute('width'));
  const height = Number(await image.getAttribute('height'));
  expect(width).toBeGreaterThan(150);
  expect(width).toBeLessThan(260);
  expect(Math.abs(width / height - 2)).toBeLessThan(0.05);
  expect(Math.round((await image.boundingBox())!.width)).toBe(width);

  const firstCol = page.locator('article .rich table col').first();
  await expect(firstCol).toHaveAttribute('style', /width: *\d+px/);
  const colWidth = Number((await firstCol.getAttribute('style'))!.match(/width: *(\d+)px/)![1]);
  expect(colWidth).toBeGreaterThan(before.width + 100);
  expect((await page.locator('article .rich th').first().boundingBox())!.width).toBeGreaterThan(before.width + 100);

  // Nach erneutem Öffnen zeigt auch der Editor die gespeicherten Maße
  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  await expect.poll(async () => Math.round((await editor.locator('img').boundingBox())?.width ?? 0)).toBe(width);
  await expect.poll(async () => (await editor.locator('th').first().boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 100);
});
