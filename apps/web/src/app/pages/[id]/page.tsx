'use client';

import type { PageDto, TreeNodeDto } from '@wiki/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { RestrictionsDialog } from '@/components/RestrictionsDialog';
import { RichText } from '@/components/RichText';
import { SpaceLayout } from '@/components/SpaceLayout';
import { Alert, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';
import { flattenTree } from '@/lib/tree';

/** Verschieben ohne Drag-and-drop: neue Elternseite auswählen, die Seite wird dort angehängt */
function MoveDialog({ page, tree, onDone, onCancel }: { page: PageDto; tree: TreeNodeDto[]; onDone: () => void; onCancel: () => void }) {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const inSubtree = (id: string) => {
    for (let cursor: string | null | undefined = id; cursor; cursor = byId.get(cursor)?.parentId) {
      if (cursor === page.id) return true;
    }
    return false;
  };
  const options = flattenTree(tree).filter((o) => !inSubtree(o.id));
  const [parentId, setParentId] = useState(page.parentId ?? '');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await api(`/pages/${page.id}/move`, { method: 'POST', body: { parentId: parentId || null, position: 100_000 } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <div className="field">
        <label htmlFor="move-parent">Neue übergeordnete Seite</label>
        <select id="move-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">(oberste Ebene)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <Alert>{error}</Alert>
      <p className="row">
        <button className="small" onClick={submit}>
          Hierher verschieben
        </button>
        <button className="small secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </p>
    </div>
  );
}

function PageView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const page = useApiData<PageDto>(`/pages/${id}`);
  const [moving, setMoving] = useState(false);
  const [restricting, setRestricting] = useState(false);
  const [treeVersion, setTreeVersion] = useState(0);
  const [error, setError] = useState('');

  async function remove(p: PageDto) {
    if (!window.confirm(`„${p.title}“ samt Unterseiten in den Papierkorb verschieben?`)) return;
    try {
      await api(`/pages/${p.id}`, { method: 'DELETE' });
      router.push(p.parentId ? `/pages/${p.parentId}` : `/spaces/${p.spaceKey}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (page.error) return <Alert>{errorMessage(page.error)}</Alert>;
  if (!page.data) return <p className="muted">Lade …</p>;
  const p = page.data;

  return (
    <SpaceLayout spaceKey={p.spaceKey} currentId={p.id} refreshKey={treeVersion} onTreeChange={() => void page.reload()}>
      {(_space, tree) => (
        <article>
          <Breadcrumbs page={p} />
          <div className="page-head">
            <h1>{p.title}</h1>
            <div className="row">
              {p.canEdit && (
                <Link className="button small" href={`/pages/${p.id}/edit`}>
                  Bearbeiten
                </Link>
              )}
              <Link className="button small secondary" href={`/pages/${p.id}/history`}>
                Verlauf
              </Link>
              {p.canEdit && !p.isHome && (
                <button className="small secondary" onClick={() => setMoving(!moving)}>
                  Verschieben
                </button>
              )}
              {p.canRestrict && (
                <button className="small secondary" onClick={() => setRestricting(!restricting)}>
                  Einschränkungen
                </button>
              )}
              {p.canDelete && (
                <button className="small danger" onClick={() => remove(p)}>
                  Löschen
                </button>
              )}
            </div>
          </div>
          <p className="muted page-meta">
            Version {p.version} · zuletzt geändert {formatDate(p.updatedAt)}
            {p.updatedBy ? ` von ${p.updatedBy.displayName}` : ''}
            {p.restricted.view && (
              <>
                {' '}
                <span className="badge warn" title="Nur bestimmte Gruppen und Personen sehen diese Seite">
                  🔒 Ansehen eingeschränkt
                </span>
              </>
            )}
            {p.restricted.edit && (
              <>
                {' '}
                <span className="badge" title="Nur bestimmte Gruppen und Personen dürfen diese Seite bearbeiten">
                  ✎ Bearbeiten eingeschränkt
                </span>
              </>
            )}
          </p>
          <Alert>{error}</Alert>
          {moving && (
            <MoveDialog
              page={p}
              tree={tree}
              onCancel={() => setMoving(false)}
              onDone={() => {
                setMoving(false);
                setTreeVersion((v) => v + 1);
                void page.reload();
              }}
            />
          )}
          {restricting && (
            <RestrictionsDialog
              page={p}
              onCancel={() => setRestricting(false)}
              onDone={() => {
                setRestricting(false);
                setTreeVersion((v) => v + 1);
                void page.reload();
              }}
            />
          )}
          <div className="page-body">
            <RichText doc={p.content} />
            <Attachments pageId={p.id} canEdit={p.canEdit} />
          </div>
        </article>
      )}
    </SpaceLayout>
  );
}

export default function Page() {
  return <RequireAuth>{() => <PageView />}</RequireAuth>;
}
