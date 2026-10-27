import { createHash, randomBytes } from 'node:crypto';
import type { MyApiTokensDto } from '@wiki/shared';
import request from 'supertest';
import { Account, createUser, ORIGIN, resetState, startApp, TestContext, totpAt } from './helpers';

let ctx: TestContext;
let admin: Account;
let anna: Account;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const RESOURCE = `${ORIGIN}/api/v1/mcp`;

beforeAll(async () => {
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await resetState(ctx);
  admin = await createUser(ctx, 'admin@example.de', { admin: true, ip: '10.0.2.1' });
  anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.2.2' });
  expect((await admin.client.put('/admin/api-access', { enabled: true })).status).toBe(200);
});

const http = () => request(ctx.app.getHttpServer());

async function code(account: Account) {
  await ctx.prisma.user.update({ where: { id: account.userId }, data: { totpLastStep: null } });
  return totpAt(account.secret, Date.now());
}

/** Wie ein OAuth-Client: ohne Cookies, Formular-Body (RFC 6749) */
function tokenRequest(form: Record<string, string>, basic?: string) {
  const req = http().post('/api/v1/oauth/token').set('X-Forwarded-For', '10.0.9.8').type('form');
  if (basic) req.set('Authorization', `Basic ${basic}`);
  return req.send(form);
}

function mcp(token: string) {
  return http()
    .post('/api/v1/mcp')
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
}

async function register(body: object = {}) {
  return http()
    .post('/api/v1/oauth/register')
    .set('X-Forwarded-For', '10.0.9.7')
    .send({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...body });
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeParams(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'read write',
    resource: RESOURCE,
    ...extra,
  };
}

/** Kompletter Ablauf bis zu den ersten Tokens */
async function connect(account: Account, scope: 'read' | 'write' = 'write') {
  const { client_id } = (await register()).body;
  const { verifier, challenge } = pkce();
  const params = authorizeParams(client_id, challenge);
  const decision = await account.client.post('/oauth/authorize', { ...params, approve: true, scope_choice: scope, expiresInDays: 30, code: await code(account) });
  expect(decision.status).toBe(200);
  const redirect = new URL(decision.body.redirect);
  const res = await tokenRequest({
    grant_type: 'authorization_code',
    code: redirect.searchParams.get('code')!,
    redirect_uri: REDIRECT,
    client_id,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  expect(res.status).toBe(200);
  return { clientId: client_id as string, tokens: res.body as { access_token: string; refresh_token: string; expires_in: number; scope: string } };
}

describe('OAuth-Metadaten', () => {
  it('beschreibt Ressource und Autorisierungsserver; der MCP-Server verweist bei 401 darauf', async () => {
    const pr = await http().get('/api/v1/.well-known/oauth-protected-resource/api/v1/mcp');
    expect(pr.status).toBe(200);
    expect(pr.body).toMatchObject({ resource: RESOURCE, authorization_servers: [ORIGIN] });
    expect((await http().get('/api/v1/.well-known/oauth-protected-resource')).body.resource).toBe(RESOURCE);

    const as = await http().get('/api/v1/.well-known/oauth-authorization-server');
    expect(as.body).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/v1/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/v1/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });

    const unauth = await http().post('/api/v1/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(unauth.status).toBe(401);
    expect(unauth.headers['www-authenticate']).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/v1/mcp"`);
  });
});

describe('Client-Registrierung', () => {
  it('erlaubt Rücksprung nur zu claude.ai/claude.com (https) und localhost', async () => {
    const ok = await register();
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
    expect(ok.body.client_secret).toBeUndefined();
    expect((await register({ redirect_uris: ['http://127.0.0.1:33418/callback'] })).status).toBe(201);

    for (const uri of ['https://evil.example/cb', 'http://claude.ai/cb', 'https://claude.ai.evil.example/cb', 'https://claude.ai/cb#x', 'javascript:alert(1)']) {
      const bad = await register({ redirect_uris: [uri] });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('invalid_redirect_uri');
    }
    expect((await register({ grant_types: ['client_credentials'] })).body.error).toBe('invalid_client_metadata');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'oauth.client.registered' } })).toBe(2);
  });

  it('ist bei ausgeschaltetem MCP-Zugang gesperrt', async () => {
    await admin.client.put('/admin/api-access', { enabled: false });
    const res = await register();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('access_denied');
  });
});

describe('Zustimmung und Tokens', () => {
  it('kompletter Ablauf: Zustimmung mit 2FA, Code mit PKCE, MCP-Aufruf, Erneuerung, Widerruf', async () => {
    const { client_id } = (await register()).body;
    const { verifier, challenge } = pkce();
    const params = authorizeParams(client_id, challenge);

    // Die Zustimmungsseite fragt nach; ohne Anmeldung geht nichts
    expect((await http().get(`/api/v1/oauth/authorize/check?${new URLSearchParams(params)}`)).status).toBe(401);
    const check = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(params)}`);
    expect(check.status).toBe(200);
    expect(check.body).toEqual({ clientName: 'Claude', redirectHost: 'claude.ai', requestedScope: 'write' });

    // Ohne gültigen 2FA-Code keine Zustimmung
    expect((await anna.client.post('/oauth/authorize', { ...params, approve: true, code: '000000' })).status).toBe(401);
    const decision = await anna.client.post('/oauth/authorize', { ...params, approve: true, scope_choice: 'write', expiresInDays: 30, code: await code(anna) });
    expect(decision.status).toBe(200);
    const redirect = new URL(decision.body.redirect);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('xyz');
    expect(redirect.searchParams.get('iss')).toBe(ORIGIN);
    const authCode = redirect.searchParams.get('code')!;

    // Falscher Verifier: abgelehnt, und der Code ist danach verbraucht
    const exchange = { grant_type: 'authorization_code', code: authCode, redirect_uri: REDIRECT, client_id, code_verifier: verifier };
    const wrong = await tokenRequest({ ...exchange, code_verifier: pkce().verifier });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('invalid_grant');
    expect((await tokenRequest(exchange)).body.error).toBe('invalid_grant');

    const { clientId, tokens } = await connect(anna);
    expect(tokens.access_token).toMatch(/^wfd_/);
    expect(tokens.refresh_token).toMatch(/^wfr_/);
    expect(tokens.expires_in).toBe(3600);
    const list = await mcp(tokens.access_token);
    expect(list.status).toBe(200);
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toContain('create_page');

    // Die Verbindung erscheint im Profil wie ein Token, mit Namen der Anwendung
    const mine = (await anna.client.get('/me/tokens')).body as MyApiTokensDto;
    expect(mine.tokens).toEqual([expect.objectContaining({ name: 'Claude', client: 'Claude', status: 'active', scope: 'write' })]);

    // Erneuerung tauscht beide Tokens aus
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers['cache-control']).toBe('no-store');
    expect((await mcp(tokens.access_token)).status).toBe(401);
    expect((await mcp(refreshed.body.access_token)).status).toBe(200);

    // Widerruf (RFC 7009) beendet die Verbindung
    const revoke = await http().post('/api/v1/oauth/revoke').type('form').send({ token: refreshed.body.refresh_token, client_id: clientId });
    expect(revoke.status).toBe(200);
    expect((await mcp(refreshed.body.access_token)).status).toBe(401);
    expect(await ctx.prisma.auditLog.count({ where: { action: { in: ['oauth.authorized', 'oauth.revoked'] } } })).toBe(2);
  });

  it('ein wiederverwendetes Refresh-Token beendet die ganze Verbindung', async () => {
    const { clientId, tokens } = await connect(anna);
    const first = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(first.status).toBe(200);
    const replay = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
    expect((await mcp(first.body.access_token)).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.body.refresh_token, client_id: clientId })).status).toBe(400);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'oauth.refresh.reused' } })).toBe(1);
  });

  it('Access-Tokens laufen nach einer Stunde ab; Lesen-Zustimmung zeigt keine ändernden Werkzeuge', async () => {
    const { tokens } = await connect(anna, 'read');
    expect(tokens.scope).toBe('read');
    const list = await mcp(tokens.access_token);
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).not.toContain('create_page');
    await ctx.prisma.apiToken.updateMany({ data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    expect((await mcp(tokens.access_token)).status).toBe(401);
  });

  it('Ablehnen schickt access_denied zurück; fremde redirect_uri und fehlendes PKCE werden nicht weitergeleitet', async () => {
    const { client_id } = (await register()).body;
    const { challenge } = pkce();
    const denied = await anna.client.post('/oauth/authorize', { ...authorizeParams(client_id, challenge), approve: false });
    expect(new URL(denied.body.redirect).searchParams.get('error')).toBe('access_denied');

    const foreign = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(authorizeParams(client_id, challenge, { redirect_uri: 'https://claude.ai/other' }))}`);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('OAUTH_INVALID_REQUEST');
    const plain = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(authorizeParams(client_id, challenge, { code_challenge_method: 'plain' }))}`);
    expect(plain.status).toBe(400);
    const otherResource = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(authorizeParams(client_id, challenge, { resource: 'https://evil.example/mcp' }))}`);
    expect(otherResource.body.error.code).toBe('OAUTH_INVALID_TARGET');
  });

  it('Widerruf im Profil, Abschalten durch den Admin und Sitzungen beenden sperren OAuth-Tokens', async () => {
    const a = await connect(anna);
    const grant = (await anna.client.get('/me/tokens')).body.tokens[0];
    expect((await anna.client.delete(`/me/tokens/${grant.id}`)).status).toBe(204);
    expect((await mcp(a.tokens.access_token)).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.tokens.refresh_token, client_id: a.clientId })).status).toBe(400);

    const b = await connect(anna);
    await admin.client.put('/admin/api-access', { enabled: false });
    expect((await mcp(b.tokens.access_token)).status).toBe(403);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: b.tokens.refresh_token, client_id: b.clientId })).status).toBe(403);
    await admin.client.put('/admin/api-access', { enabled: true });

    expect((await admin.client.delete(`/admin/users/${anna.userId}/sessions`)).status).toBe(204);
    expect((await mcp(b.tokens.access_token)).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: b.tokens.refresh_token, client_id: b.clientId })).status).toBe(400);
  });

  it('vertrauliche Clients melden sich mit Geheimnis an (Basic oder Body)', async () => {
    const reg = await register({ token_endpoint_auth_method: 'client_secret_basic' });
    const { client_id, client_secret } = reg.body;
    expect(client_secret).toBeTruthy();
    const { verifier, challenge } = pkce();
    const decision = await anna.client.post('/oauth/authorize', { ...authorizeParams(client_id, challenge), approve: true, code: await code(anna) });
    const authCode = new URL(decision.body.redirect).searchParams.get('code')!;
    const form = { grant_type: 'authorization_code', code: authCode, redirect_uri: REDIRECT, code_verifier: verifier };
    const noSecret = await tokenRequest({ ...form, client_id });
    expect(noSecret.status).toBe(401);
    expect(noSecret.body.error).toBe('invalid_client');
    const ok = await tokenRequest(form, Buffer.from(`${client_id}:${client_secret}`).toString('base64'));
    expect(ok.status).toBe(200);
  });
});
