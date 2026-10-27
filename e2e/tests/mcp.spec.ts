import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, nextCode, run } from '../helpers';

const spaceKey = `C${run.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

const XML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="r" value="Router Keller" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="140" height="60" as="geometry"/></mxCell>
<mxCell id="f" value="Firewall DMZ" style="rhombus;html=1;" vertex="1" parent="1"><mxGeometry x="260" y="10" width="120" height="80" as="geometry"/></mxCell>
<mxCell id="e" value="WAN" edge="1" parent="1" source="r" target="f"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>`;

test('Claude über MCP: Zugang einschalten, Token anlegen, Seite und Zeichnung schreiben', async ({ page, request }) => {
  const secret = await acceptInviteAndSetup2fa(page, createAdminViaCli(`claude-${run}@example.de`));
  await page.getByLabel('Schlüssel').fill(spaceKey);
  await page.getByLabel('Name', { exact: true }).fill('Claude-Test');
  await page.getByRole('button', { name: 'Space anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Claude-Test' })).toBeVisible();

  // Administration: MCP-Server einschalten (kann von einem früheren Lauf schon an sein)
  await page.goto('/admin/api');
  await expect(page.getByRole('button', { name: /^MCP-Server (ein|aus)schalten$/ })).toBeVisible();
  const on = page.getByRole('button', { name: 'MCP-Server einschalten' });
  if (await on.isVisible()) await on.click();
  await expect(page.getByRole('button', { name: 'MCP-Server ausschalten' })).toBeVisible();

  // Profil: Token mit 2FA-Code anlegen; es wird genau einmal angezeigt
  await page.goto('/profile');
  await page.getByLabel('Name', { exact: true }).fill('Playwright');
  await page.getByLabel('Code aus der App').last().fill(nextCode(secret));
  await page.getByRole('button', { name: 'Token anlegen' }).click();
  const token = await page.getByLabel('Token', { exact: true }).inputValue();
  expect(token).toMatch(/^wfd_/);
  await expect(page.getByLabel('Für Claude Code')).toHaveValue(new RegExp(`claude mcp add --transport http wiki .*/api/v1/mcp --header "Authorization: Bearer ${token}"`));
  await page.getByRole('button', { name: 'Fertig, Token ist gesichert' }).click();
  await expect(page.getByLabel('Token', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /Playwright wfd_/ })).toBeVisible();

  // Wie ein MCP-Client: eigener Kontext ohne Cookies, nur das Token
  let id = 0;
  const call = async (name: string, args: object) => {
    const res = await request.post('/api/v1/mcp', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.result.isError ?? false).toBe(false);
    return JSON.parse(body.result.content[0].text);
  };
  const created = await call('create_page', {
    space: spaceKey,
    title: 'Netzwerk von Claude',
    markdown: '## Überblick\n\nDer **Router** steht im Keller.\n\n> [!info]\n> Angelegt über MCP.',
  });
  await call('create_drawing', { pageId: created.id, title: 'Netzplan', xml: XML });

  await page.goto(`/pages/${created.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Netzwerk von Claude' })).toBeVisible();
  const content = page.locator('article .rich');
  await expect(content.getByRole('heading', { name: 'Überblick' })).toBeVisible();
  await expect(content.getByText('Angelegt über MCP.')).toBeVisible();
  const drawing = content.getByRole('img', { name: 'Netzplan' });
  await expect(drawing).toHaveAttribute('src', /\/versions\/1\?inline=1$/);
  expect(await drawing.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(500);
  await expect(page.locator('.attachment-list').getByRole('link', { name: 'Netzplan.drawio.png' })).toBeVisible();

  // Die Änderung trägt den Namen des Token-Benutzers; die Suche findet die Beschriftung der Zeichnung
  const search = await (await page.request.get('/api/v1/search?q=Firewall')).json();
  expect(search.results).toContainEqual(expect.objectContaining({ id: created.id }));
  const audit = await (await page.request.get('/api/v1/admin/audit?action=mcp')).json();
  expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['mcp.page.created', 'mcp.drawing.created']));
});
