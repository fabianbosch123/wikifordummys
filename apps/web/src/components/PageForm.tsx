'use client';

import type { DocNode, PageDto, TreeNodeDto } from '@wiki/shared';
import { PAGE_TITLE_MAX_LENGTH } from '@wiki/shared';
import dynamic from 'next/dynamic';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';

// Der Editor läuft nur im Browser
const WikiEditor = dynamic(() => import('@/components/editor/Editor').then((m) => m.WikiEditor), {
  ssr: false,
  loading: () => <p className="muted">Editor wird geladen …</p>,
});

interface Props {
  initialTitle: string;
  initialContent: DocNode;
  tree: TreeNodeDto[];
  submitLabel: string;
  /** Speichert; liefert ApiError mit Code CONFLICT, wenn jemand anderes inzwischen gespeichert hat */
  onSubmit: (title: string, content: DocNode, force: boolean) => Promise<void>;
  onCancel: () => void;
}

/** Titel und Editor mit Speichern, Konfliktanzeige und Warnung vor ungespeicherten Änderungen */
export function PageForm({ initialTitle, initialContent, tree, submitLabel, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const content = useRef<DocNode>(initialContent);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<PageDto | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(force = false) {
    setBusy(true);
    setError('');
    try {
      await onSubmit(title, content.current, force);
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

  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  return (
    <form
      onSubmit={submit}
      className="page-form"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
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
        />
      </div>
      <WikiEditor
        initial={initialContent}
        pages={tree}
        onChange={(doc) => {
          content.current = doc;
          setDirty(true);
        }}
      />
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
        <button type="submit" disabled={busy}>
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
        {dirty && <span className="muted">Ungespeicherte Änderungen</span>}
      </div>
    </form>
  );
}
