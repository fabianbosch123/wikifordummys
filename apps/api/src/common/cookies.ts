import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config';

/**
 * Mit HTTPS gelten die Präfixe __Host- (S4): nur Secure, kein Domain-Attribut, Pfad /.
 * Für lokale Entwicklung über http entfallen Präfix und Secure.
 */
export function cookieNames(config: AppConfig) {
  return config.COOKIE_SECURE
    ? { session: '__Host-session', csrf: '__Host-csrf' }
    : { session: 'wiki_session', csrf: 'wiki_csrf' };
}

function baseOptions(config: AppConfig): CookieOptions {
  return { secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/' };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string) {
  res.cookie(cookieNames(config).session, token, { ...baseOptions(config), httpOnly: true });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(cookieNames(config).session, { ...baseOptions(config), httpOnly: true });
}

/** Das CSRF-Cookie muss vom Frontend lesbar sein (Double Submit, S5). */
export function setCsrfCookie(res: Response, config: AppConfig, token: string) {
  res.cookie(cookieNames(config).csrf, token, { ...baseOptions(config), httpOnly: false });
}
