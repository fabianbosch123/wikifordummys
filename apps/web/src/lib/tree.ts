import type { TreeNodeDto } from '@wiki/shared';

export interface TreeOption {
  id: string;
  /** Seitentitel ohne Zusätze, z. B. als Linktext */
  title: string;
  /** Eingerückter Text für Auswahllisten; gleiche Titel bekommen den Pfad angehängt */
  label: string;
  depth: number;
}

/** Vergleichsform für Titel: ohne Leerraum am Rand, Groß- und Kleinschreibung egal */
export const sameTitle = (a: string, b: string) => a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de');

/**
 * Seiten des Baums eingerückt für Auswahllisten. Kommt ein Titel mehrfach vor, steht der Pfad der übergeordneten Seiten
 * dahinter („Drucker Anleitung – Team › IT“); haben auch die Pfade denselben Text, zählt eine Nummer mit.
 */
export function flattenTree(nodes: TreeNodeDto[]): TreeOption[] {
  const byParent = new Map<string | null, TreeNodeDto[]>();
  for (const n of nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  const titleCount = new Map<string, number>();
  for (const n of nodes) {
    const key = n.title.trim().toLocaleLowerCase('de');
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1);
  }
  const out: TreeOption[] = [];
  const seen = new Map<string, number>();
  const walk = (parentId: string | null, depth: number, ancestors: string[]) => {
    for (const n of (byParent.get(parentId) ?? []).sort((a, b) => a.position - b.position)) {
      let suffix = '';
      if ((titleCount.get(n.title.trim().toLocaleLowerCase('de')) ?? 0) > 1) {
        const where = ancestors.length ? ancestors.join(' › ') : 'oberste Ebene';
        const key = `${n.title.trim().toLocaleLowerCase('de')}\u0000${where}`;
        const nth = (seen.get(key) ?? 0) + 1;
        seen.set(key, nth);
        suffix = ` – ${where}${nth > 1 ? ` (${nth})` : ''}`;
      }
      out.push({ id: n.id, title: n.title, label: `${'  '.repeat(depth)}${n.title}${suffix}`, depth });
      walk(n.id, depth + 1, [...ancestors, n.title]);
    }
  };
  walk(null, 0, []);
  return out;
}

/** Titel der Geschwister (gleiche Elternseite), ohne die Seite selbst */
export function siblingTitles(nodes: TreeNodeDto[], parentId: string | null, selfId?: string): string[] {
  return nodes.filter((n) => n.parentId === parentId && n.id !== selfId).map((n) => n.title);
}
