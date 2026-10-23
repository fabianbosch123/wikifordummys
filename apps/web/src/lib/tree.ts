import type { TreeNodeDto } from '@wiki/shared';

/** Seiten des Baums eingerückt für Auswahllisten */
export function flattenTree(nodes: TreeNodeDto[]): { id: string; label: string; depth: number }[] {
  const byParent = new Map<string | null, TreeNodeDto[]>();
  for (const n of nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of (byParent.get(parentId) ?? []).sort((a, b) => a.position - b.position)) {
      out.push({ id: n.id, label: `${'  '.repeat(depth)}${n.title}`, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
