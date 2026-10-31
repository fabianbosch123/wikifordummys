'use client';

import type { DocNode, PageDto, TreeNodeDto } from '@wiki/shared';
import { PAGE_TITLE_MAX_LENGTH } from '@wiki/shared';
import dynamic from 'next/dynamic';
import { ClipboardEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { resolveUploads, UploadStore } from '@/components/editor/uploads';
import { Alert, formatDate } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useHotkeys, withHotkey } from '@/lib/hotkeys';
import { clearDraft, DISCARD_QUESTION, Draft, draftKey, loadDraft, saveDraft, useLeaveGuard } from '@/lib/unsaved';

// Der Editor läuft nur im Browser
const WikiEditor = dynamic(() => import('@/components/editor/Editor').then((m) => m.WikiEditor), {
  ssr: false,
  loading: () => <p className="muted">Editor wird geladen …</p>,
});

/** Ab dieser Länge wird der Zähler am Titel hervorgehoben */
const TITLE_WARN_AT = PAGE_TITLE_MAX_LENGTH - 20;
/** Wartezeit nach der letzten Änderung, bis der Entwurf im Browser landet */
const DRAFT_DELAY_MS = 800;

interface Props {
  initialTitle: string;
  initialContent: DocNode;
  tree: TreeNodeDto[];
  /** Bei bestehenden Seiten: Dateien werden sofort als Anhang hochgeladen */
  pageId?: string;
  /** Version, auf der die Bearbeitung beruht (bestehende Seiten); landet mit im Entwurf */
  version?: number;
  /** Eindeutig je Seite bzw. je „neue Seite unter …“, z. B. page:<id>; Schlüssel des Entwurfs im Browser */
  draftScope: string;
  submitLabel: string;
  /**
   * Speichert; liefert ApiError mit Code CONFLICT, wenn jemand anderes inzwischen gespeichert hat.
   * Neue Seite: files enthält die eingefügten Dateien (Platzhalter im Inhalt → Datei), die nach dem Anlegen hochzuladen sind.
   */
  onSubmit: (title: string, content: DocNode, force: boolean, files: Map<string, File>) => Promise<void>;
  onCancel: () => void;
  /** Ein Entwurf wurde übernommen; version ist die Version, auf der er beruht */
  onRestoreDraft?: (version: number | undefined) => void;
}

/** Titel und Editor mit Speichern, Konfliktanzeige, Entwurf im Browser und Warnung vor ungespeicherten Änderungen */
export function PageForm({ initialTitle, initialContent, tree, pageId, version, draftScope, submitLabel, onSubmit, onCancel, onRestoreDraft }: Props) {
  const { state } = useAuth();
  const userId = state?.user?.id ?? 'anon';
  const storageKey = draftKey(userId, draftScope);

  const [title, setTitle] = useState(initialTitle);
  const content = useRef<DocNode>(initialContent);
  // Editor neu aufbauen, wenn ein Entwurf übernommen wird
  const [editorStart, setEditorStart] = useState<{ doc: DocNode; n: number }>({ doc: initialContent, n: 0 });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [conflict, setConflict] = useState<PageDto | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploads] = useState(() => new UploadStore(setUploading));
  const [hasPending, setHasPending] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [titleCut, setTitleCut] = useState(false);
  const allowLeave = useLeaveGuard(dirty);

  // Gespeicherten Entwurf anbieten, wenn er sich vom geladenen Stand unterscheidet
  useEffect(() => {
    const found = loadDraft(storageKey);
    if (!found) return;
    if (found.title === initialTitle && JSON.stringify(found.content) === JSON.stringify(initialContent)) {
      clearDraft(storageKey);
      return;
    }
    setDraft(found);
  }, [storageKey]);

  /** Inhalt ohne Platzhalter halb hochgeladener Dateien (blob:-Adressen gehören nicht in den Speicher) */
  const draftContent = (doc: DocNode) => resolveUploads(doc, pageId ? uploads.done : new Map());

  // Entwurf im Browser mitschreiben, solange es ungespeicherte Änderungen gibt
  const [changeCount, setChangeCount] = useState(0);
  // Gespeichert oder bewusst abgebrochen: dann keinen Entwurf mehr anlegen
  const finished = useRef(false);
  // Beim Verlassen (Link in der App, Neuladen, Tab im Hintergrund) sofort sichern, nicht erst nach der Wartezeit
  const flush = useRef<() => void>(() => undefined);
  flush.current = () => {
    if (dirty && !finished.current) saveDraft(storageKey, { title, content: draftContent(content.current), version });
  };
  useEffect(() => {
    const onHide = () => flush.current();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush.current();
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => saveDraft(storageKey, { title, content: draftContent(content.current), version }), DRAFT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, title, changeCount, storageKey, version]);

  function markChanged() {
    setDirty(true);
    setChangeCount((n) => n + 1);
  }

  function restoreDraft(d: Draft) {
    setTitle(d.title);
    content.current = d.content;
    setEditorStart((s) => ({ doc: d.content, n: s.n + 1 }));
    onRestoreDraft?.(d.version);
    setDraft(null);
    setDirty(true);
  }

  function discardDraft() {
    clearDraft(storageKey);
    setDraft(null);
  }

  async function save(force = false) {
    // Halb hochgeladene Dateien hätten nur Platzhalter im Inhalt
    if (uploads.busy) return;
    setBusy(true);
    setError('');
    setExpired(false);
    try {
      const doc = content.current;
      // Nach dem Speichern leitet onSubmit weiter; das ist kein Verlassen mit offenen Änderungen
      allowLeave();
      finished.current = true;
      if (pageId) await onSubmit(title, resolveUploads(doc, uploads.done), force, new Map());
      else await onSubmit(title, doc, force, uploads.pendingIn(doc));
      clearDraft(storageKey);
      setDirty(false);
    } catch (err) {
      finished.current = false;
      setDirty(true);
      // Der Entwurf ist der Rettungsanker, falls der Benutzer jetzt doch wegnavigiert
      saveDraft(storageKey, { title, content: draftContent(content.current), version });
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setConflict((err.body?.error as unknown as { current: PageDto }).current);
      } else if (err instanceof ApiError && err.status === 401) {
        setExpired(true);
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

  function pasteTitle(e: ClipboardEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const pasted = e.clipboardData.getData('text').length;
    const selected = (input.selectionEnd ?? 0) - (input.selectionStart ?? 0);
    setTitleCut(input.value.length - selected + pasted > PAGE_TITLE_MAX_LENGTH);
  }

  return (
    <form onSubmit={submit} className="page-form">
      {draft && (
        <div className="alert info draft-offer" role="status">
          <p>
            Es gibt einen ungespeicherten Entwurf vom {formatDate(new Date(draft.savedAt).toISOString())}
            {draft.version !== undefined && version !== undefined && draft.version !== version
              ? ` (auf Basis von Version ${draft.version}; die Seite ist inzwischen bei Version ${version})`
              : ''}
            .
          </p>
          <p className="row">
            <button type="button" className="small" onClick={() => restoreDraft(draft)}>
              Entwurf wiederherstellen
            </button>
            <button type="button" className="small secondary" onClick={discardDraft}>
              Entwurf verwerfen
            </button>
          </p>
        </div>
      )}
      <div className="field">
        <label htmlFor="page-title">Titel</label>
        <input
          id="page-title"
          className="title-input"
          required
          maxLength={PAGE_TITLE_MAX_LENGTH}
          aria-describedby="page-title-count"
          value={title}
          onPaste={pasteTitle}
          onChange={(e) => {
            setTitle(e.target.value);
            if (e.target.value.length < PAGE_TITLE_MAX_LENGTH) setTitleCut(false);
            markChanged();
          }}
        />
        <small id="page-title-count" className={`muted title-count${title.length >= TITLE_WARN_AT ? ' warn' : ''}`}>
          {title.length} / {PAGE_TITLE_MAX_LENGTH} Zeichen
          {titleCut && ' · Der eingefügte Text war zu lang und wurde gekürzt.'}
        </small>
      </div>
      <WikiEditor
        key={editorStart.n}
        initial={editorStart.doc}
        pages={tree}
        pageId={pageId}
        uploads={uploads}
        onChange={(doc) => {
          content.current = doc;
          markChanged();
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
      {expired && (
        <div className="alert error session-expired" role="alert">
          <p>
            <strong>Deine Sitzung ist abgelaufen.</strong> Dein Text bleibt hier im Editor und ist zusätzlich als Entwurf in diesem Tab
            gesichert.
          </p>
          <ol>
            <li>
              <a href="/login" target="_blank" rel="noopener">
                In neuem Tab anmelden
              </a>
            </li>
            <li>Danach hierher zurückkehren und noch einmal „{submitLabel}“ drücken.</li>
          </ol>
        </div>
      )}
      <Alert>{error}</Alert>
      <div className="row form-actions">
        <button type="submit" disabled={busy || uploading > 0} title={withHotkey(submitLabel, 'savePage')}>
          {submitLabel}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (dirty && !window.confirm(DISCARD_QUESTION)) return;
            allowLeave();
            finished.current = true;
            clearDraft(storageKey);
            onCancel();
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
