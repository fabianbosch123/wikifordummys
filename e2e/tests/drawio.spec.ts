import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, run } from '../helpers';

const spaceKey = `Z${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

/** Wie Caddy für /draw/ (deploy/caddy/common.caddy), nur mit Inline-Skript für die Attrappe */
const DRAW_CSP =
  "sandbox allow-scripts allow-downloads allow-popups allow-modals; default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'";

/**
 * Attrappe von draw.io im Embed-Modus (Protokoll json): meldet sich wie das Original, zeigt an, was geladen wurde,
 * und liefert beim Speichern ein PNG (400×200, bei jedem Speichern eine zufällige Farbe) mit den Beschriftungen als XML.
 */
const FAKE_DRAWIO = `<!doctype html><html><body>
<p id="loaded">wartet</p><p id="sandbox"></p>
<button id="save">Speichern &amp; Beenden</button><button id="exit">Beenden</button>
<script>
var saves = 0;
function send(msg) { parent.postMessage(JSON.stringify(msg), '*'); }
try { document.cookie; parent.document.title; document.getElementById('sandbox').textContent = 'offen'; }
catch (e) { document.getElementById('sandbox').textContent = 'abgeschottet'; }
window.addEventListener('message', function (e) {
  var msg = JSON.parse(e.data);
  if (msg.action === 'configure') { document.body.setAttribute('data-libraries', msg.config.defaultLibraries); send({ event: 'init' }); }
  if (msg.action === 'load') document.getElementById('loaded').textContent = msg.xmlpng ? 'png ' + msg.xmlpng.slice(0, 22) : 'leer: ' + msg.title;
  if (msg.action === 'export') {
    var c = document.createElement('canvas'); c.width = 400; c.height = 200;
    var g = c.getContext('2d'); g.fillStyle = 'hsl(' + Math.floor(Math.random() * 360) + ', 70%, 50%)'; saves++; g.fillRect(0, 0, 400, 200);
    send({ event: 'export', format: msg.format, data: c.toDataURL('image/png') });
  }
});
document.getElementById('save').onclick = function () {
  send({ event: 'save', exit: true, xml: '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="2" value="Router Keller" vertex="1" parent="1"/><mxCell id="3" value="&lt;b&gt;Firewall&lt;/b&gt; DMZ" vertex="1" parent="1"/>' +
    '</root></mxGraphModel></diagram></mxfile>' });
};
document.getElementById('exit').onclick = function () { send({ event: 'exit' }); };
send({ event: 'configure' });
</script></body></html>`;

test('Zeichnung mit draw.io einfügen, als Bild anzeigen, bearbeiten und finden', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(msg.text());
  });
  page.on('dialog', (dialog) => {
    if (dialog.type() !== 'prompt') problems.push(dialog.message());
    void dialog.accept(dialog.type() === 'prompt' ? 'Netzwerk Büro' : undefined);
  });
  await page.route('**/draw/index.html*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', headers: { 'Content-Security-Policy': DRAW_CSP }, body: FAKE_DRAWIO }),
  );

  await acceptInviteAndSetup2fa(page, createAdminViaCli(`zeichnen-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Netzwerk');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await page.getByRole('link', { name: '+ Neue Seite' }).click();
  // Neue Seiten haben noch keinen Ort für den Anhang
  await expect(page.getByRole('button', { name: 'Zeichnung einfügen (erst nach dem Anlegen der Seite möglich)' })).toBeDisabled();
  await page.getByLabel('Titel').fill('Netzplan');
  await page.getByRole('button', { name: 'Seite anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Netzplan' })).toBeVisible();

  // Neue Zeichnung: Titel abfragen, draw.io abgeschottet im Rahmen öffnen, Speichern fügt das Bild ein
  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  await page.getByRole('button', { name: 'Zeichnung mit draw.io einfügen' }).click();
  const drawio = page.frameLocator('[data-testid=drawio-frame]');
  await expect(drawio.locator('#loaded')).toHaveText('leer: Netzwerk Büro');
  await expect(drawio.locator('#sandbox')).toHaveText('abgeschottet');
  await expect(drawio.locator('body')).toHaveAttribute('data-libraries', /network/);
  await drawio.getByRole('button', { name: 'Speichern & Beenden' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: 'Seiteninhalt' });
  const inEditor = editor.getByRole('img', { name: 'Netzwerk Büro' });
  await expect(inEditor).toHaveAttribute('src', /^\/api\/v1\/attachments\/[0-9a-f-]+\/versions\/1\?inline=1$/);
  await expect(inEditor).toHaveJSProperty('naturalWidth', 400);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();

  // Ansicht: PNG der gespeicherten Fassung in halber Größe (doppelte Auflösung), Anhang mit .drawio.png
  const content = page.locator('article .rich');
  const shown = content.getByRole('img', { name: 'Netzwerk Büro' });
  await expect(shown).toHaveAttribute('src', /\/versions\/1\?inline=1$/);
  await expect(shown).toHaveAttribute('width', '200');
  await expect(shown).toHaveJSProperty('naturalWidth', 400);
  await expect(page.locator('.attachment-list').getByRole('link', { name: 'Netzwerk Büro.drawio.png' })).toBeVisible();
  const search = await (await page.request.get('/api/v1/search?q=Firewall')).json();
  expect(search.results).toContainEqual(expect.objectContaining({ title: 'Netzplan', spaceKey }));

  // Bearbeiten lädt das gespeicherte PNG (mit den draw.io-Daten) und speichert eine neue Fassung
  await page.getByRole('link', { name: 'Bearbeiten' }).click();
  await editor.getByRole('button', { name: '✎ Zeichnung bearbeiten' }).click();
  await expect(drawio.locator('#loaded')).toHaveText('png data:image/png;base64,');
  await drawio.getByRole('button', { name: 'Speichern & Beenden' }).click();
  await expect(inEditor).toHaveAttribute('src', /\/versions\/2\?inline=1$/);
  // Beenden ohne Speichern ändert nichts
  await editor.getByRole('button', { name: '✎ Zeichnung bearbeiten' }).click();
  await drawio.getByRole('button', { name: 'Beenden', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(shown).toHaveAttribute('src', /\/versions\/2\?inline=1$/);
  await expect(page.locator('.attachment-list').getByRole('link', { name: 'Netzwerk Büro.drawio.png' })).toHaveCount(1);
  expect(problems).toEqual([]);
});
