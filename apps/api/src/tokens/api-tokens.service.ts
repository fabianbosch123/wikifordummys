import { Inject, Injectable } from '@nestjs/common';
import type { ApiToken, OAuthClient, Prisma } from '@prisma/client';
import { API_TOKEN_MAX_PER_USER, type ApiAccessDto, type ApiTokenDto, type ApiTokenScope, type CreatedApiTokenDto, type MyApiTokensDto } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { UserAccessService } from '../auth/user-access.service';
import { APP_CONFIG, AppConfig } from '../config';
import { ApiError, Errors } from '../common/errors';
import type { AuthContext, AuthUser } from '../common/request-context';
import { CryptoService } from '../infra/crypto.service';
import { PrismaService } from '../infra/prisma.service';

/** Erkennbares Präfix: Secret-Scanner (z. B. von GitHub) und Menschen sehen sofort, was das ist */
export const TOKEN_PREFIX = 'wfd_';
export const TOKEN_PATTERN = /^wfd_[A-Za-z0-9_-]{43}$/;
const SETTING_KEY = 'mcp';
const DAY_MS = 24 * 3600 * 1000;

export interface TokenAuth {
  token: ApiToken;
  user: AuthUser;
}

export const mcpDisabled = () => new ApiError(403, 'MCP_DISABLED', 'Der MCP-Zugang ist in der Administration ausgeschaltet.');

export function tokenStatus(t: Pick<ApiToken, 'revokedAt' | 'expiresAt'>, now = new Date()): ApiTokenDto['status'] {
  if (t.revokedAt) return 'revoked';
  return t.expiresAt <= now ? 'expired' : 'active';
}

/**
 * API-Tokens für den MCP-Server. Ein Token handelt immer als sein Benutzer, mit genau dessen Rechten
 * (Space-Rollen, Seiteneinschränkungen); read-Tokens dürfen zusätzlich nichts ändern.
 * In der Datenbank liegt nur der SHA-256 des Tokens, wie bei Sitzungen (S4).
 */
@Injectable()
export class ApiTokensService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly users: UserAccessService,
    private readonly audit: AuditService,
  ) {}

  get endpoint(): string {
    return `${new URL(this.config.APP_ORIGIN).origin}/api/v1/mcp`;
  }

  toDto(t: ApiToken & { client?: Pick<OAuthClient, 'name'> | null }, now = new Date()): ApiTokenDto {
    return {
      id: t.id,
      client: t.client?.name ?? null,
      name: t.name,
      prefix: t.prefix,
      scope: t.scope,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: t.lastUsedIp,
      status: tokenStatus(t, now),
    };
  }

  // ---------- Schalter in der Administration ----------

  /** Standard ist aus: Erst ein Administrator schaltet den MCP-Zugang ein */
  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    return (row?.value as { enabled?: unknown } | undefined)?.enabled === true;
  }

  async setEnabled(enabled: boolean, ctx: AuthContext, ip: string): Promise<void> {
    const value = { enabled } as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value, updatedBy: ctx.user.id },
      update: { value, updatedBy: ctx.user.id },
    });
    await this.audit.log({ action: 'admin.settings.mcp.updated', actorId: ctx.user.id, targetType: 'setting', targetId: SETTING_KEY, ip, details: { enabled } });
  }

  // ---------- Eigene Tokens ----------

  /** Abgelaufene und widerrufene Tokens bleiben 30 Tage sichtbar, danach nur noch im Audit-Log */
  private visibleSince(now: Date) {
    return new Date(now.getTime() - 30 * DAY_MS);
  }

  async listOwn(userId: string): Promise<MyApiTokensDto> {
    const now = new Date();
    const since = this.visibleSince(now);
    const rows = await this.prisma.apiToken.findMany({
      where: { userId, OR: [{ revokedAt: null }, { revokedAt: { gt: since } }], expiresAt: { gt: since } },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { enabled: await this.isEnabled(), endpoint: this.endpoint, tokens: rows.map((t) => this.toDto(t, now)) };
  }

  /**
   * Legt ein Token an. Verlangt den aktuellen 2FA-Code: Wer nur eine fremde Sitzung erbeutet hat,
   * soll sich damit keinen dauerhaften Zugang verschaffen können.
   */
  async create(
    ctx: AuthContext,
    input: { name: string; scope: ApiTokenScope; expiresInDays: number; code: string },
    ip: string,
    userAgent: string,
  ): Promise<CreatedApiTokenDto> {
    if (!(await this.isEnabled())) throw mcpDisabled();
    await this.auth.confirmTotp(ctx.user.id, input.code, { ip, userAgent }, 'api_token');
    const now = new Date();
    // OAuth-Zustimmungen zählen nicht mit; davon gibt es ohnehin nur eine je Client (oauth.service.ts)
    const active = await this.prisma.apiToken.count({ where: { userId: ctx.user.id, clientId: null, revokedAt: null, expiresAt: { gt: now } } });
    if (active >= API_TOKEN_MAX_PER_USER) {
      throw Errors.badRequest(`Höchstens ${API_TOKEN_MAX_PER_USER} aktive Tokens je Benutzer. Bitte zuerst ein altes widerrufen.`, 'TOO_MANY_TOKENS');
    }
    const token = TOKEN_PREFIX + this.crypto.randomToken(32);
    const row = await this.prisma.apiToken.create({
      data: {
        userId: ctx.user.id,
        name: input.name,
        tokenHash: this.crypto.sha256(token),
        prefix: token.slice(0, TOKEN_PREFIX.length + 4),
        scope: input.scope,
        expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
      },
    });
    await this.audit.log({
      action: 'token.created',
      actorId: ctx.user.id,
      targetType: 'api_token',
      targetId: row.id,
      ip,
      details: { name: row.name, scope: row.scope, expiresAt: row.expiresAt.toISOString() },
    });
    return { ...this.toDto(row, now), token };
  }

  /** Widerruft ein eigenes Token; fremde verhalten sich wie nicht vorhanden */
  async revokeOwn(ctx: AuthContext, id: string, ip: string): Promise<void> {
    const { count } = await this.prisma.apiToken.updateMany({ where: { id, userId: ctx.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw Errors.notFound();
    await this.audit.log({ action: 'token.revoked', actorId: ctx.user.id, targetType: 'api_token', targetId: id, ip });
  }

  // ---------- Administration ----------

  async listAll(): Promise<ApiAccessDto> {
    const now = new Date();
    const since = this.visibleSince(now);
    const rows = await this.prisma.apiToken.findMany({
      where: { OR: [{ revokedAt: null }, { revokedAt: { gt: since } }], expiresAt: { gt: since } },
      include: { user: { select: { id: true, displayName: true } }, client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      enabled: await this.isEnabled(),
      endpoint: this.endpoint,
      tokens: rows.map(({ user, ...t }) => ({ ...this.toDto(t, now), user })),
    };
  }

  async revokeAny(ctx: AuthContext, id: string, ip: string): Promise<void> {
    const token = await this.prisma.apiToken.findUnique({ where: { id } });
    if (!token) throw Errors.notFound();
    if (!token.revokedAt) await this.prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.log({
      action: 'admin.token.revoked',
      actorId: ctx.user.id,
      targetType: 'api_token',
      targetId: id,
      ip,
      details: { userId: token.userId, name: token.name },
    });
  }

  // ---------- Anmeldung mit Token ----------

  /**
   * Prüft ein Token aus dem Authorization-Header. null bei unbekanntem, abgelaufenem oder widerrufenem Token,
   * bei deaktiviertem Konto und solange das Startpasswort nicht geändert ist.
   */
  async authenticate(raw: string, ip: string): Promise<TokenAuth | null> {
    if (!TOKEN_PATTERN.test(raw)) return null;
    const token = await this.prisma.apiToken.findUnique({ where: { tokenHash: this.crypto.sha256(raw) } });
    const now = new Date();
    if (!token || tokenStatus(token, now) !== 'active') return null;
    // OAuth: das Access-Token gilt nur kurz und wird mit dem Refresh-Token erneuert
    if (token.accessExpiresAt && token.accessExpiresAt <= now) return null;
    const user = await this.users.loadActive(token.userId);
    if (!user || user.mustChangePassword) return null;
    // Zuletzt verwendet: höchstens einmal pro Minute schreiben
    if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > 60_000 || token.lastUsedIp !== ip) {
      await this.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: now, lastUsedIp: ip } });
    }
    return { token, user };
  }
}
