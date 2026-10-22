import type { ApiErrorBody } from '@wiki/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: ApiErrorBody | null,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

async function fetchCsrf(): Promise<string> {
  const res = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const body = (await res.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

/**
 * Zugriff auf die REST-API unter /api/v1.
 * Ändernde Anfragen schicken das CSRF-Token im Header X-CSRF-Token (S5).
 */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken ?? (await fetchCsrf());
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const send = () =>
    fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res = await send();
  if (res.status === 403 && method !== 'GET') {
    // Token kann sich nach dem Login geändert haben: einmal neu holen und wiederholen
    const peek = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (peek?.error?.code === 'CSRF') {
      headers['X-CSRF-Token'] = await fetchCsrf();
      res = await send();
    }
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? 'Unbekannter Fehler', body);
  }
  if (body && typeof body === 'object' && 'csrfToken' in body) {
    csrfToken = (body as { csrfToken: string }).csrfToken;
  }
  return body as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'RATE_LIMITED') {
      const seconds = err.body?.error.retryAfter;
      return seconds ? `Zu viele Versuche. Bitte in ${Math.ceil(seconds / 60)} Minute(n) erneut versuchen.` : err.message;
    }
    return err.message;
  }
  return 'Verbindung zum Server fehlgeschlagen.';
}
