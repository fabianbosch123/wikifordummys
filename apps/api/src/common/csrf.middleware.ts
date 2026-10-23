import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config';
import { CryptoService } from '../infra/crypto.service';
import { cookieNames, setCsrfCookie } from './cookies';
import { Errors } from './errors';
import type { WikiRequest } from './request-context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF-Schutz (S5): SameSite-Cookies plus Double Submit.
 * Jede ändernde Anfrage braucht den Header X-CSRF-Token mit dem Wert des CSRF-Cookies,
 * und ein mitgesendeter Origin- bzw. Referer-Header muss zur eigenen Adresse passen.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly origin: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
  ) {
    this.origin = new URL(config.APP_ORIGIN).origin;
  }

  use(req: WikiRequest, res: Response, next: NextFunction) {
    const name = cookieNames(this.config).csrf;
    let token: string | undefined = req.cookies?.[name];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      token = this.crypto.randomToken(32);
      setCsrfCookie(res, this.config, token);
      req.cookies = { ...req.cookies, [name]: token };
      if (!SAFE_METHODS.has(req.method)) return next(Errors.csrf());
    }
    req.csrfToken = token;

    if (SAFE_METHODS.has(req.method)) return next();

    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !this.crypto.safeEqual(header, token)) return next(Errors.csrf());

    const origin = req.headers.origin;
    if (origin !== undefined && origin !== this.origin) return next(Errors.csrf());
    if (origin === undefined && typeof req.headers.referer === 'string') {
      try {
        if (new URL(req.headers.referer).origin !== this.origin) return next(Errors.csrf());
      } catch {
        return next(Errors.csrf());
      }
    }
    next();
  }
}
