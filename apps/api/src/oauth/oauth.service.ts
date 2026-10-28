import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OAuthClient } from '@prisma/client';
import { API_TOKEN_LIFETIMES_DAYS, APP_OAUTH_CLIENT_ID, APP_OAUTH_REDIRECT_URI, type ApiTokenScope, type OAuthConsentInfoDto } from '@wiki/shared';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { UserAccessService } from '../auth/user-access.service';
import { APP_CONFIG, AppConfig } from '../config';
import type { AuthContext } from '../common/request-context';
import { CryptoService } from '../infra/crypto.service';
import { PrismaService } from '../infra/prisma.service';
import { RateLimitService } from '../infra/rate-limit.service';
import { REDIS } from '../infra/redis';
import { ApiTokensService, TOKEN_PREFIX } from '../tokens/api-tokens.service';

/** Fehler im Format von RFC 6749 ({ error, error_description }) */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export const ACCESS_TOKEN_SEC = 3600;
const CODE_SEC = 600;
const REFRESH_PREFIX = 'wfr_';
const REFRESH_PATTERN = /^wfr_[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 3600 * 1000;
const MAX_REDIRECT_URIS = 5;

interface StoredCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  userId: string;
  scope: ApiTokenScope;
  days: number;
}

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: ApiTokenScope;
}

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

export const APP_CLIENT_NAME = 'wikifordummys Android-App';
export const APP_MAX_DAYS = 30;
export const isAppClient = (client: Pick<OAuthClient, 'id'>) => client.id === APP_OAUTH_CLIENT_ID;

/**
 * Kleiner OAuth-2.1-Server für den MCP-Server, wie ihn die MCP-Spezifikation vorsieht: Metadaten (RFC 8414, RFC 9728),
 * Dynamic Client Registration (RFC 7591), Autorisierungscode nur mit PKCE S256, Refresh-Tokens mit Rotation und
 * Erkennung wiederverwendeter Refresh-Tokens, Widerruf (RFC 7009).
 *
 * Eine Zustimmung ist eine Zeile in api_tokens (wie ein Token aus dem Profil, mit client_id): Sie erscheint in denselben
 * Listen, lässt sich genauso widerrufen und hat dieselben Rechte wie ihr Benutzer. Zustimmen verlangt eine vollständige
 * Anmeldung im Wiki und zusätzlich den aktuellen 2FA-Code.
 *
 * Zusätzlich gibt es einen fest eingebauten Client für die Android-App (APP_OAUTH_CLIENT_ID): Seine Tokens gelten nur
 * an der REST-API und nur lesend (auth.middleware.ts, auth.guard.ts), nicht am MCP-Server, und er hängt nicht am
 * MCP-Schalter der Administration.
 */
@Injectable()
export class OAuthService {
  readonly issuer: string;
  private readonly redirectHosts: Set<string>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tokens: ApiTokensService,
    private readonly auth: AuthService,
    private readonly users: UserAccessService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimitService,
  ) {
    this.issuer = new URL(config.APP_ORIGIN).origin;
    this.redirectHosts = new Set(
      config.OAUTH_REDIRECT_HOSTS.split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  // ---------- Metadaten ----------

  /** RFC 9728: welcher Autorisierungsserver für den MCP-Server zuständig ist */
  protectedResource() {
    return {
      resource: this.tokens.endpoint,
      authorization_servers: [this.issuer],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
      resource_name: 'wikifordummys',
    };
  }

  /** RFC 8414 */
  authorizationServer() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/api/v1/oauth/token`,
      registration_endpoint: `${this.issuer}/api/v1/oauth/register`,
      revocation_endpoint: `${this.issuer}/api/v1/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['read', 'write'],
    };
  }

  /** Ressource der Android-App: die REST-API */
  get appResource(): string {
    return `${this.issuer}/api/v1`;
  }

  /** Adresse in der Antwort 401 des MCP-Servers (WWW-Authenticate: resource_metadata) */
  get resourceMetadataUrl(): string {
    return `${this.issuer}/.well-known/oauth-protected-resource${new URL(this.tokens.endpoint).pathname}`;
  }

  /** Der MCP-Schalter gilt für alle Clients außer der Android-App */
  private async requireEnabled(client?: OAuthClient) {
    if (client && isAppClient(client)) return;
    if (!(await this.tokens.isEnabled())) throw new OAuthError('access_denied', 'Der MCP-Zugang ist in der Administration ausgeschaltet.', 403);
  }

  // ---------- Client-Registrierung (RFC 7591) ----------

  /**
   * Nur Rücksprungadressen bei erlaubten Hosts (OAUTH_REDIRECT_HOSTS, Standard claude.ai und claude.com) sowie
   * http auf dem eigenen Rechner (Claude Code, Claude Desktop). So kann niemand einen Client registrieren, der Codes an
   * eine fremde Seite schickt, und Benutzer per Phishing zur Zustimmung bringt.
   */
  checkRedirectUri(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length > 2000) throw new OAuthError('invalid_redirect_uri', 'Ungültige redirect_uri.');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new OAuthError('invalid_redirect_uri', 'Ungültige redirect_uri.');
    }
    if (url.hash || url.username || url.password) throw new OAuthError('invalid_redirect_uri', 'redirect_uri ohne Fragment und Zugangsdaten angeben.');
    const host = url.hostname.toLowerCase();
    const allowed = (url.protocol === 'https:' && this.redirectHosts.has(host)) || (url.protocol === 'http:' && isLoopback(host));
    if (!allowed) {
      throw new OAuthError('invalid_redirect_uri', `Rücksprung zu ${host} ist nicht erlaubt (erlaubt: ${[...this.redirectHosts].join(', ')} und localhost).`);
    }
    return raw;
  }

  async register(body: Record<string, unknown>, ip: string) {
    await this.requireEnabled();
    await this.limiter.enforce([{ key: `oauth-register:ip:${ip}`, limit: 10, windowSec: 3600 }]);
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
      throw new OAuthError('invalid_redirect_uri', `redirect_uris: 1 bis ${MAX_REDIRECT_URIS} Adressen.`);
    }
    const redirectUris = uris.map((u) => this.checkRedirectUri(u));
    const method = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
      throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method wird nicht unterstützt.');
    }
    for (const field of ['grant_types', 'response_types'] as const) {
      const allowed = field === 'grant_types' ? ['authorization_code', 'refresh_token'] : ['code'];
      const list = body[field];
      if (list !== undefined && (!Array.isArray(list) || list.some((v) => !allowed.includes(v as string)))) {
        throw new OAuthError('invalid_client_metadata', `${field} wird nicht unterstützt.`);
      }
    }
    // eslint-disable-next-line no-control-regex
    const rawName = typeof body.client_name === 'string' ? body.client_name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    const name = rawName.slice(0, 80) || 'Unbenannte Anwendung';
    const secret = method === 'none' ? null : this.crypto.randomToken(32);

    // Angefangene Registrierungen ohne Zustimmung nicht ewig aufheben
    await this.prisma.oAuthClient.deleteMany({
      where: { id: { not: APP_OAUTH_CLIENT_ID }, createdAt: { lt: new Date(Date.now() - DAY_MS) }, tokens: { none: {} } },
    });
    const client = await this.prisma.oAuthClient.create({
      data: { name, redirectUris, secretHash: secret ? this.crypto.sha256(secret) : null, createdIp: ip },
    });
    await this.audit.log({ action: 'oauth.client.registered', targetType: 'oauth_client', targetId: client.id, ip, details: { name, redirectUris } });
    return {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    };
  }

  private async loadClient(id: unknown): Promise<OAuthClient> {
    // Der App-Client steht nicht in der Registrierung, sondern im Code; Name und Rücksprung lassen sich nicht ändern
    if (id === APP_OAUTH_CLIENT_ID) {
      const fixed = { name: APP_CLIENT_NAME, redirectUris: [APP_OAUTH_REDIRECT_URI], secretHash: null };
      const upsert = () => this.prisma.oAuthClient.upsert({ where: { id: APP_OAUTH_CLIENT_ID }, create: { id: APP_OAUTH_CLIENT_ID, ...fixed }, update: fixed });
      // Zwei gleichzeitige erste Aufrufe: der zweite legt nicht an, sondern aktualisiert
      return upsert().catch(upsert);
    }
    const client =
      typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.oAuthClient.findUnique({ where: { id } }) : null;
    if (!client) throw new OAuthError('invalid_client', 'Unbekannter Client.', 401);
    return client;
  }

  // ---------- Zustimmung ----------

  /**
   * Prüft die Anfrage der Zustimmungsseite. Fehler bei Client oder redirect_uri werden der Seite angezeigt,
   * nie per Weiterleitung gemeldet (sonst ließe sich der Rücksprung missbrauchen, RFC 6749 4.1.2.1).
   */
  async describe(params: AuthorizeParams): Promise<{ client: OAuthClient; info: OAuthConsentInfoDto }> {
    const client = await this.loadClient(params.client_id);
    await this.requireEnabled(client);
    const app = isAppClient(client);
    if (!params.redirect_uri || !client.redirectUris.includes(params.redirect_uri)) {
      throw new OAuthError('invalid_request', 'Die redirect_uri ist für diesen Client nicht registriert.');
    }
    if (params.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'Nur response_type=code wird unterstützt.');
    if (params.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge ?? '')) {
      throw new OAuthError('invalid_request', 'PKCE mit code_challenge_method=S256 ist Pflicht.');
    }
    if (params.resource && !this.resourceFits(client, params.resource)) {
      throw new OAuthError('invalid_target', 'Unbekannte resource für diesen Client.');
    }
    const scopes = (params.scope ?? '').split(' ').filter(Boolean);
    return {
      client,
      info: {
        kind: app ? 'app' : 'mcp',
        clientName: client.name,
        redirectHost: app ? 'Android-App' : new URL(params.redirect_uri).host,
        // Die App liest vorerst nur
        requestedScope: app || (scopes.length && !scopes.includes('write')) ? 'read' : 'write',
      },
    };
  }

  /** MCP-Clients bekommen Tokens für den MCP-Server, die App für die REST-API */
  private resourceFits(client: OAuthClient, resource: unknown): boolean {
    return String(resource).replace(/\/$/, '') === (isAppClient(client) ? this.appResource : this.tokens.endpoint);
  }

  /**
   * Zustimmung (approve) oder Ablehnung. Ergebnis ist die Adresse, an die die Zustimmungsseite den Browser schickt:
   * mit code und state, oder mit error=access_denied.
   */
  async decide(
    ctx: AuthContext,
    params: AuthorizeParams & { approve: boolean; scope_choice?: ApiTokenScope; expiresInDays?: number; code?: string },
    client: { ip: string; userAgent: string },
  ): Promise<string> {
    const { client: app } = await this.describe(params);
    const target = new URL(params.redirect_uri!);
    if (params.state) target.searchParams.set('state', params.state);
    target.searchParams.set('iss', this.issuer);
    if (!params.approve) {
      target.searchParams.set('error', 'access_denied');
      await this.audit.log({ action: 'oauth.denied', actorId: ctx.user.id, targetType: 'oauth_client', targetId: app.id, ip: client.ip });
      return target.toString();
    }
    const days = params.expiresInDays ?? 90;
    if (!(API_TOKEN_LIFETIMES_DAYS as readonly number[]).includes(days)) throw new OAuthError('invalid_request', 'Ungültige Gültigkeit.');
    // Das private Schema der App kann auch eine fremde App beanspruchen (RFC 8252, 8.6): Zustimmungen deshalb kurz halten
    if (isAppClient(app) && days > APP_MAX_DAYS) throw new OAuthError('invalid_request', `Für die App höchstens ${APP_MAX_DAYS} Tage.`);
    await this.auth.confirmTotp(ctx.user.id, params.code ?? '', client, 'oauth_consent');
    const code = this.crypto.randomToken(32);
    const stored: StoredCode = {
      clientId: app.id,
      redirectUri: params.redirect_uri!,
      challenge: params.code_challenge!,
      userId: ctx.user.id,
      scope: isAppClient(app) || params.scope_choice === 'read' ? 'read' : 'write',
      days,
    };
    await this.redis.set(`oauth:code:${this.crypto.sha256(code)}`, JSON.stringify(stored), 'EX', CODE_SEC);
    target.searchParams.set('code', code);
    return target.toString();
  }

  // ---------- Token-Endpunkt ----------

  /** Client-Anmeldung am Token-Endpunkt: öffentliche Clients ohne Geheimnis, vertrauliche mit */
  private async authenticateClient(body: Record<string, unknown>, basic: { id: string; secret: string } | null): Promise<OAuthClient> {
    const client = await this.loadClient(basic?.id ?? body.client_id);
    if (client.secretHash) {
      const secret = basic?.secret ?? body.client_secret;
      if (typeof secret !== 'string' || !this.crypto.safeEqual(this.crypto.sha256(secret), client.secretHash)) {
        throw new OAuthError('invalid_client', 'Client-Anmeldung fehlgeschlagen.', 401);
      }
    }
    return client;
  }

  async token(body: Record<string, unknown>, basic: { id: string; secret: string } | null, ip: string): Promise<TokenResponse> {
    await this.limiter.enforce([{ key: `oauth-token:ip:${ip}`, limit: 60, windowSec: 60 }]);
    const client = await this.authenticateClient(body, basic);
    await this.requireEnabled(client);
    if (body.grant_type === 'authorization_code') return this.exchangeCode(client, body, ip);
    if (body.grant_type === 'refresh_token') return this.refresh(client, body, ip);
    throw new OAuthError('unsupported_grant_type', 'Nur authorization_code und refresh_token.');
  }

  private async exchangeCode(client: OAuthClient, body: Record<string, unknown>, ip: string): Promise<TokenResponse> {
    const code = typeof body.code === 'string' ? body.code : '';
    // Ein Code gilt genau einmal (GETDEL)
    const raw = code ? await this.redis.getdel(`oauth:code:${this.crypto.sha256(code)}`) : null;
    const stored = raw ? (JSON.parse(raw) as StoredCode) : null;
    if (!stored || stored.clientId !== client.id) throw new OAuthError('invalid_grant', 'Der Code ist ungültig, abgelaufen oder schon verwendet.');
    if (body.redirect_uri !== stored.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri passt nicht zum Code.');
    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !this.crypto.safeEqual(challenge, stored.challenge)) {
      throw new OAuthError('invalid_grant', 'PKCE-Prüfung fehlgeschlagen.');
    }
    if (body.resource !== undefined && !this.resourceFits(client, body.resource)) {
      throw new OAuthError('invalid_target', 'Unbekannte resource.');
    }
    const user = await this.users.loadActive(stored.userId);
    if (!user) throw new OAuthError('invalid_grant', 'Das Konto ist nicht mehr aktiv.');

    const access = TOKEN_PREFIX + this.crypto.randomToken(32);
    const refresh = REFRESH_PREFIX + this.crypto.randomToken(32);
    const now = new Date();
    const grant = await this.prisma.$transaction(async (tx) => {
      // Eine Zustimmung je Benutzer und Client: eine neue ersetzt die alte
      await tx.apiToken.updateMany({ where: { userId: user.id, clientId: client.id, revokedAt: null }, data: { revokedAt: now } });
      return tx.apiToken.create({
        data: {
          userId: user.id,
          clientId: client.id,
          name: client.name,
          tokenHash: this.crypto.sha256(access),
          prefix: access.slice(0, TOKEN_PREFIX.length + 4),
          refreshHash: this.crypto.sha256(refresh),
          scope: stored.scope,
          accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_SEC * 1000),
          expiresAt: new Date(now.getTime() + stored.days * DAY_MS),
        },
      });
    });
    await this.audit.log({
      action: 'oauth.authorized',
      actorId: user.id,
      targetType: 'api_token',
      targetId: grant.id,
      ip,
      details: { clientId: client.id, client: client.name, scope: grant.scope, expiresAt: grant.expiresAt.toISOString() },
    });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SEC, refresh_token: refresh, scope: grant.scope };
  }

  /**
   * Neues Access-Token gegen das Refresh-Token; beide werden ausgetauscht. Wird ein bereits ersetztes Refresh-Token
   * nochmals vorgelegt, hat es vermutlich jemand kopiert: Dann endet die ganze Zustimmung (OAuth 2.1, 4.3.1).
   */
  private async refresh(client: OAuthClient, body: Record<string, unknown>, ip: string): Promise<TokenResponse> {
    const raw = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!REFRESH_PATTERN.test(raw)) throw new OAuthError('invalid_grant', 'Ungültiges Refresh-Token.');
    const hash = this.crypto.sha256(raw);
    const grant = await this.prisma.apiToken.findUnique({ where: { refreshHash: hash } });
    if (!grant) {
      const reusedId = await this.redis.get(`oauth:used-refresh:${hash}`);
      if (reusedId) {
        await this.prisma.apiToken.updateMany({ where: { id: reusedId, revokedAt: null }, data: { revokedAt: new Date() } });
        await this.audit.log({ action: 'oauth.refresh.reused', targetType: 'api_token', targetId: reusedId, ip, details: { clientId: client.id } });
      }
      throw new OAuthError('invalid_grant', 'Ungültiges Refresh-Token.');
    }
    const now = new Date();
    if (grant.clientId !== client.id || grant.revokedAt || grant.expiresAt <= now) throw new OAuthError('invalid_grant', 'Die Zustimmung ist abgelaufen oder widerrufen.');
    if (!(await this.users.loadActive(grant.userId))) throw new OAuthError('invalid_grant', 'Das Konto ist nicht mehr aktiv.');

    const access = TOKEN_PREFIX + this.crypto.randomToken(32);
    const refresh = REFRESH_PREFIX + this.crypto.randomToken(32);
    // Nur austauschen, wenn noch dieses Refresh-Token gilt (zwei gleichzeitige Anfragen gewinnen nicht beide)
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id: grant.id, refreshHash: hash },
      data: {
        tokenHash: this.crypto.sha256(access),
        prefix: access.slice(0, TOKEN_PREFIX.length + 4),
        refreshHash: this.crypto.sha256(refresh),
        accessExpiresAt: new Date(Math.min(now.getTime() + ACCESS_TOKEN_SEC * 1000, grant.expiresAt.getTime())),
      },
    });
    if (count === 0) throw new OAuthError('invalid_grant', 'Ungültiges Refresh-Token.');
    await this.redis.set(`oauth:used-refresh:${hash}`, grant.id, 'PX', Math.max(1000, grant.expiresAt.getTime() - now.getTime()));
    const expiresIn = Math.max(1, Math.floor((Math.min(now.getTime() + ACCESS_TOKEN_SEC * 1000, grant.expiresAt.getTime()) - now.getTime()) / 1000));
    return { access_token: access, token_type: 'Bearer', expires_in: expiresIn, refresh_token: refresh, scope: grant.scope };
  }

  /** RFC 7009: widerruft die ganze Zustimmung; unbekannte Tokens sind kein Fehler */
  async revoke(body: Record<string, unknown>, basic: { id: string; secret: string } | null, ip: string): Promise<void> {
    await this.limiter.enforce([{ key: `oauth-token:ip:${ip}`, limit: 60, windowSec: 60 }]);
    const client = await this.authenticateClient(body, basic);
    const raw = typeof body.token === 'string' ? body.token : '';
    if (!raw) throw new OAuthError('invalid_request', 'token fehlt.');
    const hash = this.crypto.sha256(raw);
    const grant = await this.prisma.apiToken.findFirst({ where: { clientId: client.id, OR: [{ tokenHash: hash }, { refreshHash: hash }] } });
    if (!grant || grant.revokedAt) return;
    await this.prisma.apiToken.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await this.audit.log({ action: 'oauth.revoked', actorId: grant.userId, targetType: 'api_token', targetId: grant.id, ip, details: { clientId: client.id } });
  }
}
