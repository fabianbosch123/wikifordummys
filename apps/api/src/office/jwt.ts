import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * JSON Web Tokens mit HS256, wie sie der Editor-Server (Euro-Office/ONLYOFFICE Docs-API) erwartet und sendet.
 * Bewusst klein gehalten: nur HS256, keine anderen Algorithmen, Ablaufzeit (exp) wird geprüft, wenn vorhanden.
 */
export type JwtClaims = Record<string, unknown>;

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function signature(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Signiert die Angaben; mit expiresInSec kommen iat und exp hinzu */
export function signJwt(claims: JwtClaims, secret: string, expiresInSec?: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = expiresInSec ? { ...claims, iat, exp: iat + expiresInSec } : claims;
  const data = `${HEADER}.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
  return `${data}.${signature(data, secret)}`;
}

/** Prüft Signatur, Algorithmus und Ablaufzeit; null bei jedem Fehler */
export function verifyJwt(token: string, secret: string, now = Date.now()): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 64 * 1024) return null;
  const [header, payload, sig] = parts;
  const expected = Buffer.from(signature(`${header}.${payload}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown };
    if (head.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    const exp = (claims as JwtClaims).exp;
    if (exp !== undefined && (typeof exp !== 'number' || exp * 1000 < now)) return null;
    return claims as JwtClaims;
  } catch {
    return null;
  }
}
