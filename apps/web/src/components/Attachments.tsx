'use client';

import type { AttachmentDto, AttachmentVersionDto } from '@wiki/shared';
import Link from 'next/link';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Alert, formatDate } from '@/components/ui';
import { api, errorMessage, uploadAttachment, uploadAttachmentVersion } from '@/lib/api';
import { useApiData } from '@/lib/data';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

/** Ältere Fassungen eines Anhangs (entstehen beim Speichern im Office-Editor), nur zum Herunterladen */
function Versions({ attachment }: { attachment: AttachmentDto }) {
  const [versions, setVersions] = useState<AttachmentVersionDto[] | null>(null);
  const [error, setError] = useState('');

  async function load() {
    if (versions) return;
    try {
      setVersions(await api<AttachmentVersionDto[]>(`/attachments/${attachment.id}/versions`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <details className="attachment-versions" onToggle={(e) => e.currentTarget.open && void load()}>
      <summary>Fassung {attachment.version}</summary>
      <Alert>{error}</Alert>
      <ul>
        {versions?.map((v) => (
          <li key={v.version}>
            {v.version === attachment.version ? (
              <span>Fassung {v.version} (aktuell)</span>
            ) : (
              <a href={v.url}>Fassung {v.version}</a>
            )}{' '}
            <small className="muted">
              {formatSize(v.sizeBytes)} · {v.createdBy?.displayName ?? 'unbekannt'} · {formatDate(v.createdAt)}
            </small>
          </li>
        ))}
      </ul>
    </details>
  );
}

const sameName = (a: string, b: string) => a.normalize('NFC').toLocaleLowerCase('de') === b.normalize('NFC').toLocaleLowerCase('de');

/** Freier Name nach dem Muster „notiz (2).txt“, „notiz (3).txt“ … */
export function uniqueFilename(name: string, taken: string[]): string {
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.some((t) => sameName(t, candidate))) return candidate;
  }
}

/** Dateiendungen, die ein Vorschaubild oder PDF versprechen; passt der Inhalt nicht, zeigt das Symbol nur „DATEI“ */
const PREVIEW_EXTENSIONS: Record<string, 'image' | 'pdf'> = { png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', pdf: 'pdf' };

function fileLabel(a: AttachmentDto): string {
  if (a.preview === 'pdf') return 'PDF';
  const ext = (a.filename.includes('.') ? (a.filename.split('.').pop() ?? '') : '').toLowerCase();
  if (!ext || (PREVIEW_EXTENSIONS[ext] && PREVIEW_EXTENSIONS[ext] !== a.preview)) return 'DATEI';
  return ext.slice(0, 5).toUpperCase();
}

/** Rückfrage, wenn eine Datei so heißt wie ein vorhandener Anhang (N-5) */
function DuplicatePrompt({
  file,
  existing,
  busy,
  onVersion,
  onKeep,
  onSkip,
}: {
  file: File;
  existing: AttachmentDto;
  busy: boolean;
  onVersion: () => void;
  onKeep: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="alert info duplicate-prompt" role="alertdialog" aria-label="Datei gibt es schon">
      <p>
        „{file.name}“ hängt schon an dieser Seite (Fassung {existing.version}, {formatSize(existing.sizeBytes)}). Was soll mit der neuen Datei
        passieren?
      </p>
      <p className="row">
        <button type="button" className="small" disabled={busy} onClick={onVersion}>
          Als neue Fassung speichern
        </button>
        <button type="button" className="small secondary" disabled={busy} onClick={onKeep}>
          Als eigene Datei behalten
        </button>
        <button type="button" className="small secondary" disabled={busy} onClick={onSkip}>
          Nicht hochladen
        </button>
      </p>
    </div>
  );
}

const PANEL_KEY = 'wiki.attachments.open';

/** Ob das Anhänge-Panel offen ist, wird pro Browser gemerkt (Standard: offen) */
function usePanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(PANEL_KEY) === '0') setOpen(false);
    } catch {
      // Speicher gesperrt (z. B. privates Fenster): bleibt offen
    }
  }, []);
  function update(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(PANEL_KEY, next ? '1' : '0');
    } catch {
      // nicht merkbar, gilt dann nur für diese Ansicht
    }
  }
  return [open, update];
}

/**
 * Anhänge einer Seite als aufklappbares Panel rechts neben dem Inhalt:
 * Bilder mit Vorschau, PDF zum Öffnen im Browser, Office-Dokumente im Editor, alles andere zum Herunterladen
 */
export function Attachments({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const list = useApiData<AttachmentDto[]>(`/pages/${pageId}/attachments`);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = usePanelOpen();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Dateien, deren Name es schon gibt, warten auf die Entscheidung; die erste wird gefragt
  const [queue, setQueue] = useState<{ file: File; existing: AttachmentDto }[]>([]);
  const [message, setMessage] = useState('');

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const current = list.data ?? [];
    const duplicates: { file: File; existing: AttachmentDto }[] = [];
    const fresh: File[] = [];
    for (const file of files) {
      const existing = current.find((a) => sameName(a.filename, file.name));
      if (existing) duplicates.push({ file, existing });
      else fresh.push(file);
    }
    setError('');
    setMessage('');
    setQueue((q) => [...q, ...duplicates]);
    if (fresh.length) await run(async () => {
      const mismatched: string[] = [];
      for (const file of fresh) {
        const created = await uploadAttachment(pageId, file);
        if (fileLabel(created) === 'DATEI' && /\.(png|jpe?g|gif|webp|pdf)$/i.test(created.filename)) mismatched.push(created.filename);
      }
      // Endung verspricht Bild oder PDF, der Inhalt ist etwas anderes: nur zum Herunterladen (SEC-Hinweis aus dem Review)
      if (mismatched.length) setMessage(`${mismatched.map((n) => `„${n}“`).join(', ')}: Der Inhalt passt nicht zur Endung, die Datei gibt es nur zum Herunterladen.`);
    });
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      await list.reload();
    }
  }

  /** Erledigt die erste wartende Datei: neue Fassung, unter freiem Namen behalten oder auslassen */
  async function decide(choice: 'version' | 'keep' | 'skip') {
    const [next] = queue;
    if (!next) return;
    setError('');
    setMessage('');
    if (choice !== 'skip') {
      await run(async () => {
        if (choice === 'version') {
          const updated = await uploadAttachmentVersion(next.existing.id, next.file);
          setMessage(
            updated.version === next.existing.version
              ? `„${updated.filename}“ hat schon genau diesen Inhalt, es gibt keine neue Fassung.`
              : `„${updated.filename}“ ist jetzt Fassung ${updated.version}. Ältere Fassungen gibt es unter „Fassung ${updated.version}“.`,
          );
        } else {
          const taken = [...(list.data ?? []).map((a) => a.filename), ...queue.map((q) => q.file.name)];
          const name = uniqueFilename(next.file.name, taken);
          await uploadAttachment(pageId, new File([next.file], name, { type: next.file.type }));
          setMessage(`Als „${name}“ hochgeladen.`);
        }
      });
    }
    setQueue((q) => q.slice(1));
  }

  async function remove(a: AttachmentDto) {
    if (!window.confirm(`Anhang „${a.filename}“ löschen? Bilder, die ihn in Seiten einbinden, werden dann nicht mehr angezeigt.`)) return;
    try {
      await api(`/attachments/${a.id}`, { method: 'DELETE' });
      await list.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const count = list.data?.length;

  return (
    <aside className="attachments" aria-label="Anhänge">
      <details open={open} onToggle={(e) => e.currentTarget.open !== open && setOpen(e.currentTarget.open)}>
        <summary>
          <h2>Anhänge{count !== undefined && <span className="count"> ({count})</span>}</h2>
        </summary>
        {list.error && <Alert>{errorMessage(list.error)}</Alert>}
        {count === 0 && <p className="muted">Keine Anhänge.</p>}
        <ul className="attachment-list">
          {list.data?.map((a) => (
            <li key={a.id}>
              {a.preview === 'image' ? (
                <img src={a.url} alt="" loading="lazy" />
              ) : (
                <span className="file-icon" aria-hidden>
                  {fileLabel(a)}
                </span>
              )}
              <span className="name">
                <a href={a.url} target={a.preview ? '_blank' : undefined} rel="noopener">
                  {a.filename}
                </a>
                <br />
                <small className="muted">
                  {formatSize(a.sizeBytes)} · {a.uploadedBy?.displayName ?? 'unbekannt'} · {formatDate(a.createdAt)}
                  {a.version > 1 && <> · geändert {formatDate(a.updatedAt)}</>}
                </small>
                {a.version > 1 && <Versions attachment={a} />}
              </span>
              <span className="actions">
                {a.office && (
                  <Link className="button small secondary" href={`/attachments/${a.id}/office?mode=view`}>
                    Ansehen
                  </Link>
                )}
                {a.office === 'edit' && (
                  <Link className="button small" href={`/attachments/${a.id}/office?mode=edit`}>
                    Bearbeiten
                  </Link>
                )}
                <a className="button small secondary" href={`${a.url}?download=1`}>
                  Herunterladen
                </a>
                {canEdit && (
                  <button className="small danger" onClick={() => remove(a)}>
                    Löschen
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {queue[0] && (
          <DuplicatePrompt
            file={queue[0].file}
            existing={queue[0].existing}
            busy={busy}
            onVersion={() => void decide('version')}
            onKeep={() => void decide('keep')}
            onSkip={() => void decide('skip')}
          />
        )}
        {canEdit && (
          <p className="row">
            <input ref={input} type="file" multiple hidden onChange={upload} data-testid="attachment-input" />
            <button className="small" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Wird hochgeladen …' : 'Datei hochladen'}
            </button>
          </p>
        )}
        <Alert kind="success">{message}</Alert>
        <Alert>{error}</Alert>
      </details>
    </aside>
  );
}
