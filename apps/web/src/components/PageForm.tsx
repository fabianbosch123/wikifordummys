'use client';

import type { DocNode, PageDto, TreeNodeDto } from '@wiki/shared';
import { PAGE_TITLE_MAX_LENGTH } from '@wiki/shared';
import dynamic from 'next/dynamic';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { resolveUploads, UploadStore } from '@/components/editor/uploads';
import { Alert } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { useHotkeys, withHotkey } from '@/lib/hotkeys';
import { sameTitle } from '@/lib/tree';

// Der Editor läuft nur im Browser
const WikiEditor = dynamic(() => import('@/components/editor/Editor').then((m) => m.WikiEditor), {
  ssr: false,
  loading: () => <p className="muted">Editor wird geladen …</p>,
});

interface Props {
  initialTitle: string;
  initialContent: DocNode;
  tree: TreeNodeDto[];
  /** Bei bestehenden Seiten: Dateien werden sofort als Anhang hochgeladen */
  pageId?: string;
  submitLabel: string;
  /**
   * Speichert; liefert ApiError mit Code CONFLICT, wenn jemand anderes inzwischen gespeichert hat.
   * Neue Seite: files enthält die eingefügten Dateien (Platzhalter im Inhalt → Datei), die nach dem Anlegen hochzuladen sind.
   */
  onSubmit: (title: string, content: DocNode, force: boolean, files: Map<string, File>) => Promise<void>;
  onCancel: () => void;
  /** Titel der anderen Seiten unter derselben Elternseite; bei gleichem Titel warnt das Formular */
  siblingTitles?: string[];
}

/** Titel und Editor mit Speichern, Konfliktanzeige und Warnung vor ungespeicherten Änderungen */
export function PageForm({ initialTitle, initialContent, tree, pageId, submitLabel, onSubmit, onCancel, siblingTitles = [] }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const content = useRef<DocNode>(initialContent);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<PageDto | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploads] = useState(() => new UploadStore(setUploading));
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const duplicate = title.trim() !== '' && !sameTitle(title, initialTitle) && siblingTitles.some((t) => sameTitle(t, title));
  // Einmal bestätigt, fragt das Formular für diesen Titel nicht noch einmal
  const confirmedDuplicate = useRef('');

  async function save(force = false) {
    // Halb hochgeladene Dateien hätten nur Platzhalter im Inhalt
    if (uploads.busy) return;
    if (duplicate && confirmedDuplicate.current !== title.trim()) {
      if (!window.confirm(`Unter derselben Seite gibt es schon eine Seite „${title.trim()}“. Trotzdem mit diesem Titel speichern?`)) return;
      confirmedDuplicate.current = title.trim();
    }
    setBusy(true);
    setError('');
    try {
      const doc = content.current;
      if (pageId) await onSubmit(title, resolveUploads(doc, uploads.done), force, new Map());
      else await onSubmit(title, doc, force, uploads.pendingIn(doc));
      setDirty(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setConflict((err.body?.error as unknown as { current: PageDto }).current);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  // Auch im Editor und im Titelfeld; unterdrückt „Seite speichern unter“ des Browsers
  useHotkeys({
    savePage: () => {
      if (!busy) void save();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  return (
    <form onSubmit={submit} className="page-form">
      <div className="field">
        <label htmlFor="page-title">Titel</label>
        <input
          id="page-title"
          className="title-input"
          required
          maxLength={PAGE_TITLE_MAX_LENGTH}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          aria-describedby={duplicate ? 'page-title-duplicate' : undefined}
        />
        {duplicate && (
          <small id="page-title-duplicate" className="field-warning" role="status">
            Unter derselben Seite gibt es schon eine Seite mit diesem Titel. Ein anderer Titel hilft beim Wiederfinden.
          </small>
        )}
      </div>
      <WikiEditor
        initial={initialContent}
        pages={tree}
        pageId={pageId}
        uploads={uploads}
        onChange={(doc) => {
          content.current = doc;
          setDirty(true);
          if (!pageId) setHasPending(uploads.pendingIn(doc).size > 0);
        }}
      />
      {hasPending && <p className="muted">Eingefügte Dateien werden beim Anlegen der Seite als Anhang hochgeladen.</p>}
      {conflict && (
        <div className="alert error" role="alert">
          <p>
            Die Seite wurde inzwischen von {conflict.updatedBy?.displayName ?? 'jemand anderem'} geändert (jetzt Version {conflict.version}).
            Deine Änderungen sind noch hier im Editor.
          </p>
          <p className="row">
            <button type="button" className="small danger" disabled={busy} onClick={() => void save(true)}>
              Trotzdem speichern
            </button>
            <a href={`/pages/${conflict.id}`} target="_blank" rel="noopener">
              Aktuelle Fassung in neuem Tab ansehen
            </a>
          </p>
          <p className="muted">Beim Überschreiben bleibt die andere Fassung im Verlauf erhalten.</p>
        </div>
      )}
      <Alert>{error}</Alert>
      <div className="row">
        <button type="submit" disabled={busy || uploading > 0} title={withHotkey(submitLabel, 'savePage')}>
          {submitLabel}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (!dirty || window.confirm('Ungespeicherte Änderungen verwerfen?')) onCancel();
          }}
        >
          Abbrechen
        </button>
        {uploading > 0 ? (
          <span className="muted" role="status">
            Dateien werden hochgeladen …
          </span>
        ) : (
          dirty && <span className="muted">Ungespeicherte Änderungen</span>
        )}
      </div>
    </form>
  );
}
