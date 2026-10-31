'use client';

import type { SpaceDto, TreeNodeDto } from '@wiki/shared';
import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { PageTree } from '@/components/PageTree';
import { Alert } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApiData } from '@/lib/data';

/** Space mit Seitenbaum links und Inhalt rechts */
export function SpaceLayout({
  spaceKey,
  currentId,
  refreshKey = 0,
  onTreeChange,
  children,
}: {
  spaceKey: string;
  currentId?: string;
  /** Erhöhen, um den Baum nach Änderungen neu zu laden */
  refreshKey?: number;
  onTreeChange?: () => void;
  children: ReactNode | ((space: SpaceDto, tree: TreeNodeDto[]) => ReactNode);
}) {
  const space = useApiData<SpaceDto>(`/spaces/${encodeURIComponent(spaceKey)}`);
  const tree = useApiData<TreeNodeDto[]>(`/spaces/${encodeURIComponent(spaceKey)}/tree`);
  const [error, setError] = useState('');
  // Auf schmalen Bildschirmen ist der Seitenbaum zugeklappt, damit der Inhalt zuerst kommt
  const [treeOpen, setTreeOpen] = useState(false);
  const reloadTree = tree.reload;

  useEffect(() => {
    if (refreshKey) void reloadTree();
  }, [refreshKey, reloadTree]);

  async function move(id: string, parentId: string | null, position: number) {
    setError('');
    try {
      await api(`/pages/${id}/move`, { method: 'POST', body: { parentId, position } });
      await reloadTree();
      onTreeChange?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (space.error) return <Alert>{errorMessage(space.error)}</Alert>;
  if (!space.data || !tree.data) return <p className="muted">Lade …</p>;
  const s = space.data;

  return (
    <div className="space-layout">
      <aside className="sidebar">
        <div className="sidebar-head">
          <Link href={s.homePageId ? `/pages/${s.homePageId}` : `/spaces/${s.key}`} className="space-name">
            {s.name}
          </Link>
          <span className="badge">{s.key}</span>
          {s.status === 'archived' && <span className="badge warn">archiviert</span>}
          <button
            type="button"
            className="small secondary sidebar-toggle"
            aria-expanded={treeOpen}
            aria-controls="sidebar-body"
            onClick={() => setTreeOpen(!treeOpen)}
          >
            {treeOpen ? 'Seitenbaum ausblenden' : 'Seitenbaum zeigen'}
          </button>
        </div>
        <div id="sidebar-body" className={`sidebar-body${treeOpen ? ' open' : ''}`}>
          {s.canEdit && (
            <p>
              <Link className="button small" href={`/spaces/${s.key}/new${currentId ? `?parent=${currentId}` : ''}`}>
                + Neue Seite
              </Link>
            </p>
          )}
          <PageTree spaceKey={s.key} nodes={tree.data} currentId={currentId} homePageId={s.homePageId} canEdit={s.canEdit} onMove={move} />
          <Alert>{error}</Alert>
          {s.role === 'admin' && (
            <p className="sidebar-foot">
              <Link href={`/spaces/${s.key}/settings`}>Space-Einstellungen</Link>
              <Link href={`/spaces/${s.key}/trash`}>Papierkorb</Link>
            </p>
          )}
        </div>
      </aside>
      <div className="space-content">{typeof children === 'function' ? children(s, tree.data) : children}</div>
    </div>
  );
}
