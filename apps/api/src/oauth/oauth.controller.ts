import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { API_TOKEN_LIFETIMES_DAYS, API_TOKEN_SCOPES, type ApiTokenScope, type OAuthConsentInfoDto } from '@wiki/shared';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Auth, Public } from '../common/decorators';
import { ApiError } from '../common/errors';
import { AuthContext, clientIp, userAgent, WikiRequest } from '../common/request-context';
import { AuthorizeParams, OAuthError, OAuthService } from './oauth.service';

/** Parameter der Autorisierungsanfrage, wie sie die Zustimmungsseite aus ihrer Adresse übernimmt */
class AuthorizeQueryDto implements AuthorizeParams {
  @IsOptional() @IsString() @MaxLength(50) response_type?: string;
  @IsOptional() @IsString() @MaxLength(100) client_id?: string;
  @IsOptional() @IsString() @MaxLength(2000) redirect_uri?: string;
  @IsOptional() @IsString() @MaxLength(200) code_challenge?: string;
  @IsOptional() @IsString() @MaxLength(20) code_challenge_method?: string;
  @IsOptional() @IsString() @MaxLength(1000) state?: string;
  @IsOptional() @IsString() @MaxLength(200) scope?: string;
  @IsOptional() @IsString() @MaxLength(2000) resource?: string;
}

class AuthorizeDecisionDto extends AuthorizeQueryDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsIn(API_TOKEN_SCOPES)
  scope_choice?: ApiTokenScope;

  @IsOptional()
  @Type(() => Number)
  @IsIn(API_TOKEN_LIFETIMES_DAYS)
  expiresInDays?: number;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Der Code besteht aus 6 Ziffern.' })
  code?: string;
}

type Basic = { id: string; secret: string } | null;

/** Client-Anmeldung per HTTP Basic (client_secret_basic); Teile sind URL-kodiert (RFC 6749, 2.3.1) */
function basicAuth(req: WikiRequest): Basic {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) throw new OAuthError('invalid_client', 'Ungültige Client-Anmeldung.', 401);
  try {
    return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
  } catch {
    throw new OAuthError('invalid_client', 'Ungültige Client-Anmeldung.', 401);
  }
}

function body(req: WikiRequest): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
}

/** Antwort im OAuth-Format; Tokens dürfen in keinem Cache landen */
async function respond(res: Response, status: number, run: () => Promise<unknown>) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  try {
    const result = await run();
    res.status(status).json(result ?? {});
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    if (err.status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="wikifordummys"');
    res.status(err.status).json({ error: err.error, error_description: err.description });
  }
}

/** Für die Zustimmungsseite: OAuth-Fehler im gewohnten Format der API, damit die Seite sie anzeigen kann */
async function forWeb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof OAuthError) throw new ApiError(err.status === 401 ? 400 : err.status, `OAUTH_${err.error.toUpperCase()}`, err.description);
    throw err;
  }
}

/**
 * OAuth 2.1 für den MCP-Server (claude.ai-Connectors). Metadaten, Registrierung, Token und Widerruf sind öffentlich und
 * kommen ohne Cookies aus (deshalb ohne CSRF, siehe csrf.middleware.ts). Die Zustimmung selbst gibt nur ein vollständig
 * angemeldeter Benutzer über die Seite /oauth/authorize der Weboberfläche, mit CSRF-Schutz und 2FA-Code.
 *
 * Caddy leitet /.well-known/oauth-* auf /api/v1/.well-known/oauth-* um (deploy/caddy/common.caddy).
 */
@Controller()
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Public()
  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/api/v1/mcp'])
  protectedResource() {
    return this.oauth.protectedResource();
  }

  @Public()
  @Get('.well-known/oauth-authorization-server')
  authorizationServer() {
    return this.oauth.authorizationServer();
  }

  @Public()
  @Post('oauth/register')
  async register(@Req() req: WikiRequest, @Res() res: Response) {
    await respond(res, 201, () => this.oauth.register(body(req), clientIp(req)));
  }

  @Public()
  @Post('oauth/token')
  async token(@Req() req: WikiRequest, @Res() res: Response) {
    await respond(res, 200, async () => this.oauth.token(body(req), basicAuth(req), clientIp(req)));
  }

  @Public()
  @Post('oauth/revoke')
  async revoke(@Req() req: WikiRequest, @Res() res: Response) {
    await respond(res, 200, async () => this.oauth.revoke(body(req), basicAuth(req), clientIp(req)));
  }

  /** Zustimmungsseite: wer fragt an? */
  @Get('oauth/authorize/check')
  check(@Query() query: AuthorizeQueryDto): Promise<OAuthConsentInfoDto> {
    return forWeb(async () => (await this.oauth.describe(query)).info);
  }

  /** Zustimmung oder Ablehnung; die Seite leitet den Browser danach auf redirect weiter */
  @Post('oauth/authorize')
  @HttpCode(200)
  decide(@Body() dto: AuthorizeDecisionDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest): Promise<{ redirect: string }> {
    return forWeb(async () => ({ redirect: await this.oauth.decide(ctx, dto, { ip: clientIp(req), userAgent: userAgent(req) }) }));
  }
}
