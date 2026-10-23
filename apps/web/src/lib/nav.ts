/** Nur relative Pfade innerhalb des Wikis zulassen (kein offener Redirect) */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}
