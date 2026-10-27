import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { acceptInviteAndSetup2fa, createAdminViaCli, nextCode, PASSWORD, run } from '../helpers';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

test('claude.ai-Connector: Anmeldung per OAuth mit Zustimmungsseite im Wiki', async ({ page, request, browser, baseURL }) => {
  const email = `oauth-${run}@example.de`;
  const secret = await acceptInviteAndSetup2fa(page, createAdminViaCli(email));
  await page.goto('/admin/api');
  await expect(page.getByRole('button', { name: /^MCP-Server (ein|aus)schalten$/ })).toBeVisible();
  const on = page.getByRole('button', { name: 'MCP-Server einschalten' });
  if (await on.isVisible()) await on.click();
  await expect(page.getByRole('button', { name: 'MCP-Server ausschalten' })).toBeVisible();

  // Wie claude.ai: Metadaten an fester Stelle finden, Client registrieren
  const meta = await (await request.get('/.well-known/oauth-authorization-server')).json();
  expect(meta.authorization_endpoint).toBe(`${baseURL}/oauth/authorize`);
  const reg = await request.post('/api/v1/oauth/register', { data: { client_name: 'Claude (E2E)', redirect_uris: [REDIRECT] } });
  expect(reg.status()).toBe(201);
  const clientId: string = (await reg.json()).client_id;
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'e2e-state',
    scope: 'write',
    resource: `${baseURL}/api/v1/mcp`,
  });

  // Ohne Anmeldung führt die Seite zum Login und behält dabei alle Parameter
  const fresh = await browser.newContext();
  const anon = await fresh.newPage();
  await anon.goto(`/oauth/authorize?${params}`);
  await expect(anon).toHaveURL(/\/login\?next=/);
  await anon.getByLabel('E-Mail').fill(email);
  await anon.getByLabel('Passwort').fill(PASSWORD);
  await anon.getByRole('button', { name: 'Weiter' }).click();
  await expect(anon).toHaveURL(/\/login\/2fa\?next=/);
  expect(new URL(anon.url()).searchParams.get('next')).toBe(`/oauth/authorize?${params}`);
  await fresh.close();

  // Angemeldet: Zustimmung mit 2FA-Code, dann zurück zu claude.ai (hier abgefangen)
  await page.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'claude.ai' }));
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page.getByText('Claude (E2E)')).toBeVisible();
  await expect(page.getByText('claude.ai', { exact: true })).toBeVisible();
  await page.getByLabel('Code aus der App').fill(nextCode(secret));
  await page.getByRole('button', { name: 'Zulassen' }).click();
  await page.waitForURL(/^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?/);
  const back = new URL(page.url());
  expect(back.searchParams.get('state')).toBe('e2e-state');

  const tokenRes = await request.post('/api/v1/oauth/token', {
    form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier },
  });
  expect(tokenRes.status()).toBe(200);
  const { access_token } = await tokenRes.json();
  const list = await request.post('/api/v1/mcp', {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(list.status()).toBe(200);

  // Die Verbindung steht im Profil und lässt sich dort widerrufen
  await page.goto('/profile');
  await expect(page.getByRole('cell', { name: /Claude \(E2E\) Connector \(OAuth\)/ })).toBeVisible();
});
