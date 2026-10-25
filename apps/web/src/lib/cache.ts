/**
 * Zwischenspeicher für GET-Antworten der API im Browser-Tab. Beim Wechsel zwischen Seiten erscheint der
 * letzte bekannte Stand sofort und wird im Hintergrund aktualisiert. Jede ändernde Anfrage (auch An- und
 * Abmelden) leert ihn, damit nach dem Speichern nie ein alter Stand aufblitzt.
 */
const MAX_ENTRIES = 200;
const entries = new Map<string, unknown>();
/** Steigt bei jedem Leeren; Antworten, die davor angefragt wurden, landen nicht mehr im Speicher */
let generation = 0;

export function cacheGeneration(): number {
  return generation;
}

export function readCache<T>(path: string): T | undefined {
  return entries.get(path) as T | undefined;
}

export function writeCache(path: string, value: unknown, since = generation) {
  if (since !== generation) return;
  entries.delete(path);
  entries.set(path, value);
  // Älteste Einträge zuerst verwerfen
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

export function dropCache(path: string) {
  entries.delete(path);
}

export function clearCache() {
  entries.clear();
  generation++;
}
