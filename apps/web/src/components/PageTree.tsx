'use client';

import type { TreeNodeDto } from '@wiki/shared';
import Link from 'next/link';
import { DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { prefetchApiData } from '@/lib/data';

type DropZone = 'before' | 'inside' | 'after';

/** Höchstzahl gemerkter aufgeklappter Seiten je Space */
const MAX_STORED = 500;

/** Aufgeklappte Seiten aus dem Sitzungsspeicher, null wenn für diesen Space noch nichts gemerkt ist */
function loadExpanded(key: string): string[] | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_STORED);
  } catch {
    // Speicher gesperrt oder Inhalt kaputt: wie beim ersten Besuch
    return null;
  }
}

function saveExpanded(key: string, ids: Set<string>) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify([...ids].slice(0, MAX_STORED)));
  } catch {
    // nicht merkbar, gilt dann nur für diese Ansicht
  }
}

interface Props {
  spaceKey: string;
  nodes: TreeNodeDto[];
  currentId?: string;
  homePageId?: string | null;
  canEdit: boolean;
  onMove: (id: string, parentId: string | null, position: number) => void;
}

/**
 * Seitenbaum eines Spaces. Mit Bearbeitungsrecht lassen sich Seiten per Drag-and-drop verschieben:
 * oberes/unteres Viertel einer Zeile = davor/dahinter einsortieren, Mitte = als Unterseite anhängen.
 * Ein Klick auf eine Seite öffnet sie und klappt ihre Unterseiten auf bzw. zu. Welche Seiten
 * aufgeklappt sind, wird pro Space für die Browsersitzung gemerkt, weil der Baum bei jedem
 * Seitenwechsel neu aufgebaut wird.
 */
export function PageTree({ spaceKey, nodes, currentId, homePageId, canEdit, onMove }: Props) {
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
  const storageKey = `wiki.tree.expanded.${spaceKey}`;
  const restored = useRef(false);
  const [ready, setReady] = useState(false);

  // Gemerkten Zustand übernehmen (beim ersten Besuch die Startseite) und die Vorfahren der aktuellen Seite aufklappen
  useEffect(() => {
    const first = !restored.current;
    restored.current = true;
    const stored = first ? loadExpanded(storageKey) : null;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (stored) for (const id of stored) next.add(id);
      else if (first && homePageId) next.add(homePageId);
      let cursor = currentId ? byId.get(currentId)?.parentId : null;
      while (cursor) {
        next.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
      return next;
    });
    setReady(true);
  }, [currentId, homePageId, byId, storageKey]);

  useEffect(() => {
    if (ready) saveExpanded(storageKey, expanded);
  }, [ready, expanded, storageKey]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Nur ein normaler Klick klappt um, nicht Strg-/Mittelklick zum Öffnen in einem neuen Tab
  const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

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
                    onClick={() => toggle(node.id)}
                  >
                    {open ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="twisty" />
                )}
                <Link
                  href={`/pages/${node.id}`}
                  aria-current={node.id === currentId ? 'page' : undefined}
                  // Lange Titel kürzt der Baum nach zwei Zeilen; der volle Titel steht im Tooltip
                  title={node.title.length > 40 ? node.title : undefined}
                  onClick={(e) => {
                    if (hasChildren && plainClick(e)) toggle(node.id);
                  }}
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
