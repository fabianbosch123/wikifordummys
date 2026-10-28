import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { APP_OAUTH_CLIENT_ID } from '@wiki/shared';
import type { NextFunction, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config';
import { SessionService } from '../auth/session.service';
import { UserAccessService } from '../auth/user-access.service';
import { RateLimitService } from '../infra/rate-limit.service';
import { ApiTokensService } from '../tokens/api-tokens.service';
import { clearSessionCookie, cookieNames } from './cookies';
import { ApiError } from './errors';
import { clientIp, clientNet, userAgent, type WikiRequest } from './request-context';

/**
 * Diese Pfade prüfen „Authorization“ selbst oder brauchen keine Anmeldung: MCP (eigene Tokens), OAuth (Client-Anmeldung
 * per Basic), OAuth-Metadaten (MCP-Clients schicken dort womöglich ihr Token mit) und der Office-Editor-Server (JWT bei
 * Rückruf und Dateiabruf, office.service.ts)
 */
const OWN_AUTHORIZATION = ['/api/v1/mcp', '/api/v1/oauth/', '/api/v1/.well-known/', '/api/v1/office/'];

const invalidToken = () => new ApiError(401, 'INVALID_TOKEN', 'Fehlendes, ungültiges, abgelaufenes oder widerrufenes Token.');

/**
 * Liest das Session-Cookie und hängt Sitzung und Benutzer an die Anfrage.
 *
 * Alternativ „Authorization: Bearer“ mit einem OAuth-Token der Android-App. Dann zählt das Cookie nicht, auch wenn eines
 * mitkommt, und der Guard lässt nur markierte Routen und nur lesende Methoden zu. Ein Browser kann diesen Header für eine
 * fremde Seite nicht setzen (keine CORS-Freigabe), deshalb braucht dieser Weg kein CSRF-Token.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly origin: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly users: UserAccessService,
    private readonly tokens: ApiTokensService,
    private readonly limiter: RateLimitService,
    private readonly audit: AuditService,
  ) {
    this.origin = new URL(config.APP_ORIGIN).origin;
  }

  async use(req: WikiRequest, res: Response, next: NextFunction) {
    try {
      const path = req.originalUrl.split('?')[0];
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
      if (bearer !== undefined && !OWN_AUTHORIZATION.some((p) => path === p || path.startsWith(p))) {
        await this.useAppToken(req, bearer);
        return next();
      }
      const token = req.cookies?.[cookieNames(this.config).session];
      if (typeof token === 'string' && token) {
        const session = await this.sessions.get(token);
        const user = session ? await this.users.loadActive(session.userId) : null;
        if (session && user) {
          req.auth = { session, user };
        } else {
          // Abgelaufen, beendet oder Konto deaktiviert
          if (session) await this.sessions.destroy(session);
          clearSessionCookie(res, this.config);
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  /**
   * Nur Tokens aus der OAuth-Zustimmung für die App; Profil- und MCP-Tokens gelten hier nicht.
   * Ein gültiges Token kommt immer durch: Die Sperre (je Absendernetz) greift nur auf dem Fehlerweg, damit niemand im
   * selben Netz die App anderer aussperren kann. Ein abgelaufenes Access-Token ist kein Fehlversuch, die App erneuert dann.
   */
  private async useAppToken(req: WikiRequest, raw: string) {
    // Aus einer fremden Webseite heraus (Browser schicken Origin mit) nie, wie beim MCP-Server
    if (req.headers.origin !== undefined && req.headers.origin !== this.origin) throw invalidToken();
    const ip = clientIp(req);
    const auth = await this.tokens.authenticate(raw, ip);
    if (!auth || auth.token.clientId !== APP_OAUTH_CLIENT_ID) {
      const scope = `app-token:net:${clientNet(ip)}`;
      await this.limiter.assertNotLocked(scope);
      if (!(await this.tokens.isKnown(raw))) {
        await this.limiter.registerFailure(scope, 10);
        await this.audit.log({ action: 'app.auth.failed', ip, details: { prefix: raw.slice(0, 8) } });
      }
      throw invalidToken();
    }
    const now = Date.now();
    req.auth = {
      session: {
        id: `token:${auth.token.id}`,
        token: '',
        userId: auth.user.id,
        stage: 'full',
        createdAt: auth.token.createdAt.getTime(),
        lastSeenAt: now,
        ip,
        userAgent: userAgent(req),
      },
      user: auth.user,
      appToken: { id: auth.token.id },
    };
  }
}
