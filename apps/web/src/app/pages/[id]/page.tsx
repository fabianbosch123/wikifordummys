'use client';

import { docToText, type DocNode, type PageDto, type SpaceDto, type TreeNodeDto } from '@wiki/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { RestrictionsDialog } from '@/components/RestrictionsDialog';
import { RichText } from '@/components/RichText';
import { SpaceLayout } from '@/components/SpaceLayout';
import { NotFound } from '@/components/NotFound';
import { Alert, DialogPanel, formatDate } from '@/components/ui';
import { api, errorMessage, isNotFound } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';
import { type DeletedFlash, setFlash, takeFlash } from '@/lib/deleted-notice';
import { useHotkeys, withHotkey } from '@/lib/hotkeys';
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
    <DialogPanel title="Verschieben" onClose={onCancel}>
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
    </DialogPanel>
  );
}

/** Hinweisleiste nach dem Löschen: wohin die Seite gegangen ist, mit Rückgängig */
function DeletedNotice({ flash, onClose }: { flash: DeletedFlash; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function undo() {
    setBusy(true);
    setError('');
    try {
      await api(`/pages/${flash.pageId}/undelete`, { method: 'POST' });
      router.push(`/pages/${flash.pageId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="alert success notice" role="status">
      <span>
        „{flash.title}“ wurde samt Unterseiten in den <Link href={`/spaces/${flash.spaceKey}/trash`}>Papierkorb</Link> verschoben.
      </span>
      <span className="row">
        <button type="button" className="small" disabled={busy} onClick={undo}>
          Rückgängig
        </button>
        <button type="button" className="small secondary" aria-label="Hinweis schließen" onClick={onClose}>
          ✕
        </button>
      </span>
      {error && <span className="notice-error">{error}</span>}
    </div>
  );
}

/** Kein Text, kein Bild, keine Tabelle: die Seite ist noch leer */
const isEmptyDoc = (doc: DocNode) => docToText(doc).trim() === '';

/** Hinweis statt weißer Fläche, mit den nächsten Schritten */
function EmptyPageHint({ page, space }: { page: PageDto; space: SpaceDto }) {
  return (
    <div className="rich empty-page" data-testid="empty-page">
      <p>
        <strong>Diese Seite ist noch leer.</strong>
      </p>
      {page.canEdit ? (
        <p className="row">
          <Link className="button small" href={`/pages/${page.id}/edit`} title={withHotkey('Seite bearbeiten', 'editPage')}>
            Inhalt schreiben (E)
          </Link>
          {space.canEdit && (
            <Link className="button small secondary" href={`/spaces/${space.key}/new?parent=${page.id}`}>
              + Unterseite anlegen
            </Link>
          )}
        </p>
      ) : (
        <p className="muted">Sobald jemand Inhalt einträgt, erscheint er hier.</p>
      )}
    </div>
  );
}

function PageView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const page = useApiData<PageDto>(`/pages/${id}`);
  // Immer nur ein Panel offen
  const [panel, setPanel] = useState<'move' | 'restrict' | null>(null);
  const moving = panel === 'move';
  const restricting = panel === 'restrict';
  const setMoving = (open: boolean) => setPanel(open ? 'move' : null);
  const setRestricting = (open: boolean) => setPanel(open ? 'restrict' : null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState<DeletedFlash | null>(null);
  const isHome = page.data?.id === id && page.data.isHome;
  const spaceKey = page.data?.id === id ? page.data.spaceKey : null;
  useHotkeys({ editPage: page.data?.canEdit ? () => router.push(`/pages/${id}/edit`) : undefined });

  // Hinweis vom Löschen einer Unterseite abholen (oberste Seiten landen auf der Startseite des Spaces)
  // Ein abgeholter Hinweis bleibt, solange er zur angezeigten Seite gehört; beim Wechsel auf eine andere Seite verschwindet er
  useEffect(() => {
    const spaceTarget = isHome && spaceKey ? `space:${spaceKey}` : null;
    const flash = takeFlash(id) ?? (spaceTarget ? takeFlash(spaceTarget) : null);
    setDeleted((prev) => flash ?? (prev && (prev.showOn === id || prev.showOn === spaceTarget) ? prev : null));
  }, [id, isHome, spaceKey]);

  async function remove(p: PageDto) {
    if (!window.confirm(`„${p.title}“ samt Unterseiten in den Papierkorb verschieben?`)) return;
    try {
      await api(`/pages/${p.id}`, { method: 'DELETE' });
      setFlash({ kind: 'page-deleted', pageId: p.id, title: p.title, spaceKey: p.spaceKey, showOn: p.parentId ?? `space:${p.spaceKey}` });
      router.push(p.parentId ? `/pages/${p.parentId}` : `/spaces/${p.spaceKey}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (isNotFound(page.error)) return <NotFound kind="page" />;
  if (page.error) return <Alert>{errorMessage(page.error)}</Alert>;
  if (!page.data) return <p className="muted">Lade …</p>;
  const p = page.data;

  return (
    <SpaceLayout spaceKey={p.spaceKey} currentId={p.id} refreshKey={treeVersion} onTreeChange={() => void page.reload()}>
      {(space, tree) => (
        <article>
          {deleted && <DeletedNotice flash={deleted} onClose={() => setDeleted(null)} />}
          <Breadcrumbs page={p} />
          <div className="page-head">
            <h1>{p.title}</h1>
            <div className="row">
              {p.canEdit && (
                <Link className="button small" href={`/pages/${p.id}/edit`} title={withHotkey('Seite bearbeiten', 'editPage')}>
                  Bearbeiten
                </Link>
              )}
              <Link className="button small secondary" href={`/pages/${p.id}/history`}>
                Verlauf
              </Link>
              {p.canEdit && !p.isHome && (
                <button className="small secondary" aria-expanded={moving} onClick={() => setMoving(!moving)}>
                  Verschieben
                </button>
              )}
              {p.canRestrict && (
                <button className="small secondary" aria-expanded={restricting} onClick={() => setRestricting(!restricting)}>
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
            {isEmptyDoc(p.content) ? <EmptyPageHint page={p} space={space} /> : <RichText doc={p.content} />}
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
