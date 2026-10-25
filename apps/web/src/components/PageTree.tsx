'use client';

import type { TreeNodeDto } from '@wiki/shared';
import Link from 'next/link';
import { DragEvent, useEffect, useMemo, useState } from 'react';
import { prefetchApiData } from '@/lib/data';

type DropZone = 'before' | 'inside' | 'after';

interface Props {
  nodes: TreeNodeDto[];
  currentId?: string;
  homePageId?: string | null;
  canEdit: boolean;
  onMove: (id: string, parentId: string | null, position: number) => void;
}

/**
 * Seitenbaum eines Spaces. Mit Bearbeitungsrecht lassen sich Seiten per Drag-and-drop verschieben:
 * oberes/unteres Viertel einer Zeile = davor/dahinter einsortieren, Mitte = als Unterseite anhängen.
 */
export function PageTree({ nodes, currentId, homePageId, canEdit, onMove }: Props) {
  const children = useMemo(() => {
    const map = new Map<string | null, TreeNodeDto[]>();
    for (const n of nodes) map.set(n.parentId, [...(map.get(n.parentId) ?? []), n]);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);

  // Vorfahren der aktuellen Seite und die Startseite aufklappen
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (homePageId) next.add(homePageId);
      let cursor = currentId ? byId.get(currentId)?.parentId : null;
      while (cursor) {
        next.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
      return next;
    });
  }, [currentId, homePageId, byId]);

  const isDescendant = (id: string, ancestorId: string) => {
    let cursor: string | null | undefined = id;
    while (cursor) {
      if (cursor === ancestorId) return true;
      cursor = byId.get(cursor)?.parentId;
    }
    return false;
  };

  function zoneFor(e: DragEvent<HTMLElement>, target: TreeNodeDto): DropZone | null {
    if (!dragId || isDescendant(target.id, dragId)) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    // Neben der Startseite auf oberster Ebene einsortieren ist erlaubt, aber nicht vor ihr
    if (y < 0.25 && target.id !== homePageId) return 'before';
    if (y > 0.75 && target.id !== homePageId) return 'after';
    return 'inside';
  }

  function handleDrop(target: TreeNodeDto, zone: DropZone) {
    if (!dragId) return;
    if (zone === 'inside') {
      onMove(dragId, target.id, 100_000);
      setExpanded((prev) => new Set(prev).add(target.id));
      return;
    }
    const siblings = (children.get(target.parentId) ?? []).filter((n) => n.id !== dragId);
    const index = siblings.findIndex((n) => n.id === target.id);
    onMove(dragId, target.parentId, zone === 'before' ? index : index + 1);
  }

  const renderLevel = (parentId: string | null, depth: number) => {
    const list = children.get(parentId) ?? [];
    if (list.length === 0) return null;
    return (
      <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Seitenbaum' : undefined}>
        {list.map((node) => {
          const hasChildren = (children.get(node.id) ?? []).length > 0;
          const open = expanded.has(node.id);
          const draggable = canEdit && node.id !== homePageId;
          const zone = drop?.id === node.id ? drop.zone : null;
          return (
            <li key={node.id} role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={node.id === currentId}>
              <div
                className={`tree-row${node.id === currentId ? ' current' : ''}${zone ? ` drop-${zone}` : ''}${dragId === node.id ? ' dragging' : ''}`}
                data-testid={`tree-${node.title}`}
                draggable={draggable}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', node.id);
                  setDragId(node.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDrop(null);
                }}
                onDragOver={(e) => {
                  const z = zoneFor(e, node);
                  if (!z) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (drop?.id !== node.id || drop.zone !== z) setDrop({ id: node.id, zone: z });
                }}
                onDragLeave={() => setDrop((d) => (d?.id === node.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  const z = zoneFor(e, node);
                  if (z) handleDrop(node, z);
                  setDragId(null);
                  setDrop(null);
                }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="twisty"
                    aria-label={open ? `${node.title} zuklappen` : `${node.title} aufklappen`}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (open) next.delete(node.id);
                        else next.add(node.id);
                        return next;
                      })
                    }
                  >
                    {open ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="twisty" />
                )}
                <Link
                  href={`/pages/${node.id}`}
                  aria-current={node.id === currentId ? 'page' : undefined}
                  onMouseEnter={() => prefetchApiData(`/pages/${node.id}`)}
                  onFocus={() => prefetchApiData(`/pages/${node.id}`)}
                >
                  {node.title}
                </Link>
              </div>
              {hasChildren && open && renderLevel(node.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return <nav className="page-tree">{renderLevel(null, 0)}</nav>;
}
