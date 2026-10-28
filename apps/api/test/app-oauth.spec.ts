import { createHash, randomBytes } from 'node:crypto';
import { APP_OAUTH_CLIENT_ID, APP_OAUTH_REDIRECT_URI } from '@wiki/shared';
import request from 'supertest';
import { createPage, createSpace } from './fixtures';
import { Account, createUser, ORIGIN, resetState, startApp, TestContext, totpAt } from './helpers';

let ctx: TestContext;
let admin: Account;
let anna: Account;

const APP_RESOURCE = `${ORIGIN}/api/v1`;

beforeAll(async () => {
  ctx = await startApp();
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await resetState(ctx);
  admin = await createUser(ctx, 'admin@example.de', { admin: true, ip: '10.0.3.1' });
  anna = await createUser(ctx, 'anna@example.de', { ip: '10.0.3.2' });
});

const http = () => request(ctx.app.getHttpServer());

async function code(account: Account) {
  await ctx.prisma.user.update({ where: { id: account.userId }, data: { totpLastStep: null } });
  return totpAt(account.secret, Date.now());
}

/** Wie die App: ohne Cookies, nur mit dem Token */
function appGet(path: string, token: string) {
  return http().get(`/api/v1${path}`).set('X-Forwarded-For', '10.0.9.20').set('Authorization', `Bearer ${token}`);
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function appParams(challenge: string, extra: Record<string, string> = {}) {
  return {
    response_type: 'code',
    client_id: APP_OAUTH_CLIENT_ID,
    redirect_uri: APP_OAUTH_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'app-state',
    resource: APP_RESOURCE,
    ...extra,
  };
}

/** Anmeldung der App über die Zustimmungsseite bis zu den ersten Tokens */
async function connectApp(account: Account) {
  const { verifier, challenge } = pkce();
  const params = appParams(challenge);
  // Wer „write“ wählt, bekommt trotzdem nur Lesezugriff
  const decision = await account.client.post('/oauth/authorize', { ...params, approve: true, scope_choice: 'write', expiresInDays: 30, code: await code(account) });
  expect(decision.status).toBe(200);
  const redirect = new URL(decision.body.redirect);
  expect(`${redirect.protocol}${redirect.pathname}`).toBe(APP_OAUTH_REDIRECT_URI);
  expect(redirect.searchParams.get('state')).toBe('app-state');
  const res = await http()
    .post('/api/v1/oauth/token')
    .set('X-Forwarded-For', '10.0.9.21')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      code: redirect.searchParams.get('code')!,
      redirect_uri: APP_OAUTH_REDIRECT_URI,
      client_id: APP_OAUTH_CLIENT_ID,
      code_verifier: verifier,
      resource: APP_RESOURCE,
    });
  expect(res.status).toBe(200);
  return res.body as { access_token: string; refresh_token: string; scope: string };
}

describe('Android-App: Anmeldung per OAuth', () => {
  it('funktioniert ohne eingeschalteten MCP-Zugang, nur lesend und mit festem Rücksprung in die App', async () => {
    const { challenge } = pkce();
    const check = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(appParams(challenge, { scope: 'read write' }))}`);
    expect(check.status).toBe(200);
    expect(check.body).toEqual({ kind: 'app', clientName: 'wikifordummys Android-App', redirectHost: 'Android-App', requestedScope: 'read' });

    const tokens = await connectApp(anna);
    expect(tokens.scope).toBe('read');
    const me = await appGet('/me', tokens.access_token);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('anna@example.de');

    // Die Zustimmung steht im Profil und lässt sich dort widerrufen
    const list = await anna.client.get('/me/tokens');
    expect(list.body.tokens).toEqual([expect.objectContaining({ client: 'wikifordummys Android-App', scope: 'read', status: 'active' })]);
    expect((await anna.client.delete(`/me/tokens/${list.body.tokens[0].id}`)).status).toBe(204);
    expect((await appGet('/me', tokens.access_token)).status).toBe(401);
  });

  it('sieht Spaces und Seiten mit den Rechten des Benutzers', async () => {
    await createSpace(anna.client, 'IT', 'IT-Team', { open: false });
    const page = await createPage(anna.client, 'IT', 'Server');
    const annaApp = await connectApp(anna);
    expect((await appGet('/spaces', annaApp.access_token)).body.map((s: { key: string }) => s.key)).toContain('IT');
    expect((await appGet(`/pages/${page.id}`, annaApp.access_token)).status).toBe(200);
    expect((await appGet('/search?q=Server', annaApp.access_token)).status).toBe(200);

    const bernd = await createUser(ctx, 'bernd@example.de', { ip: '10.0.3.3' });
    const berndApp = await connectApp(bernd);
    expect((await appGet(`/pages/${page.id}`, berndApp.access_token)).status).toBe(404);
  });

  it('erlaubt mit dem App-Token weder Änderungen noch Konto, Tokens oder Administration', async () => {
    await createSpace(anna.client);
    const { access_token } = await connectApp(anna);
    const bearer = (r: request.Test) => r.set('X-Forwarded-For', '10.0.9.22').set('Authorization', `Bearer ${access_token}`);

    expect((await bearer(http().post('/api/v1/spaces')).send({ key: 'NEU', name: 'Neu' })).status).toBe(403);
    expect((await bearer(http().patch('/api/v1/me')).send({ displayName: 'x' })).status).toBe(403);
    for (const path of ['/me/sessions', '/me/tokens', '/admin/users', '/admin/api-access', '/directory']) {
      expect((await appGet(path, access_token)).status, path).toBe(403);
    }
    const adminApp = await connectApp(admin);
    expect((await appGet('/admin/users', adminApp.access_token)).status).toBe(403);
  });

  it('nimmt an der REST-API nur App-Tokens an und an MCP keine App-Tokens', async () => {
    await admin.client.put('/admin/api-access', { enabled: true });
    const profile = await anna.client.post('/me/tokens', { name: 'Claude', scope: 'read', expiresInDays: 30, code: await code(anna) });
    expect(profile.status).toBe(201);
    expect((await appGet('/me', profile.body.token)).status).toBe(401);

    const { access_token } = await connectApp(anna);
    const mcp = await http()
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(mcp.status).toBe(401);
  });

  it('ignoriert das Cookie, sobald ein Token mitkommt, und weist fremde Origins ab', async () => {
    // Gültige Sitzung im Cookie, aber falsches Token: keine Anmeldung über das Cookie
    const res = await anna.client.get('/me').set('Authorization', 'Bearer wfd_falsch');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');

    const { access_token } = await connectApp(anna);
    expect((await appGet('/me', access_token).set('Origin', 'https://evil.example')).status).toBe(401);
  });

  it('weist falsche Rücksprungadressen, Ressourcen und fremde Codes ab', async () => {
    const { challenge } = pkce();
    const wrongRedirect = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(appParams(challenge, { redirect_uri: 'https://claude.ai/cb' }))}`);
    expect(wrongRedirect.status).toBe(400);
    const wrongResource = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(appParams(challenge, { resource: `${ORIGIN}/api/v1/mcp` }))}`);
    expect(wrongResource.status).toBe(400);

    // Name und Rücksprung des App-Clients lassen sich in der Datenbank nicht dauerhaft verbiegen
    await connectApp(anna);
    await ctx.prisma.oAuthClient.update({ where: { id: APP_OAUTH_CLIENT_ID }, data: { name: 'Fake', redirectUris: ['https://evil.example/cb'] } });
    const check = await anna.client.get(`/oauth/authorize/check?${new URLSearchParams(appParams(challenge))}`);
    expect(check.body.clientName).toBe('wikifordummys Android-App');
    expect((await ctx.prisma.oAuthClient.findUnique({ where: { id: APP_OAUTH_CLIENT_ID } }))?.redirectUris).toEqual([APP_OAUTH_REDIRECT_URI]);
  });
  it('sperrt nach Fehlversuchen nur das Raten, nie ein gültiges Token, und zählt abgelaufene Tokens nicht', async () => {
    const { access_token } = await connectApp(anna);
    for (let i = 0; i < 10; i++) expect((await appGet('/me', `wfd_${'x'.repeat(43)}`)).status).toBe(401);
    expect((await appGet('/me', `wfd_${'x'.repeat(43)}`)).status).toBe(429);
    expect((await appGet('/me', access_token)).status).toBe(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'app.auth.failed' } })).toBe(10);

    await ctx.redis.flushdb();
    await ctx.prisma.apiToken.updateMany({ data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    for (let i = 0; i < 12; i++) expect((await appGet('/me', access_token)).status).toBe(401);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'app.auth.failed' } })).toBe(10);
  });

  it('gilt nicht an öffentlichen Routen und stört die OAuth-Metadaten nicht', async () => {
    const { access_token } = await connectApp(anna);
    expect((await appGet('/auth/session', access_token)).status).toBe(403);
    expect((await appGet('/.well-known/oauth-protected-resource/api/v1/mcp', 'wfd_irgendein-mcp-token')).status).toBe(200);
    expect((await appGet('/health', 'nicht-bearer').set('Authorization', 'Basic eDp5')).status).not.toBe(401);
    // Der Office-Editor-Server schickt beim Abruf sein JWT als Bearer mit (wikictl office-check holt /api/v1/health)
    expect((await appGet('/health', 'eyJhbGciOiJIUzI1NiJ9.e30.x')).status).not.toBe(401);
  });

  it('erlaubt für die App höchstens 30 Tage', async () => {
    const { challenge } = pkce();
    const res = await anna.client.post('/oauth/authorize', { ...appParams(challenge), approve: true, expiresInDays: 90, code: await code(anna) });
    expect(res.status).toBe(400);
  });
});
