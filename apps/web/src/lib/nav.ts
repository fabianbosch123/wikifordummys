/** Nur zum Auflösen relativer Pfade; die Adresse selbst wird nie aufgerufen */
const BASE = 'https://wiki.invalid';

/**
 * Nur Pfade innerhalb des Wikis zulassen (kein offener Redirect). Browser entfernen Tab und Zeilenumbruch aus
 * Adressen, aus „/\t/evil.example“ würde so „//evil.example“ (SEC-005). Deshalb Steuerzeichen und Backslashes
 * ablehnen, die Adresse wie der Browser auflösen und nur behalten, was auf dem eigenen Ursprung bleibt.
 */
export function safeNext(next: string | null): string {
  // eslint-disable-next-line no-control-regex
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  try {
    const url = new URL(next, BASE);
    return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}
