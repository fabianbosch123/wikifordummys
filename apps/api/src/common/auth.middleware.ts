import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config';
import { SessionService } from '../auth/session.service';
import { UserAccessService } from '../auth/user-access.service';
import { clearSessionCookie, cookieNames } from './cookies';
import type { WikiRequest } from './request-context';

/** Liest das Session-Cookie und hängt Sitzung und Benutzer an die Anfrage. */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly users: UserAccessService,
  ) {}

  async use(req: WikiRequest, res: Response, next: NextFunction) {
    try {
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
}
