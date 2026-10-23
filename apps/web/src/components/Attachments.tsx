'use client';

import type { AttachmentDto, AttachmentVersionDto } from '@wiki/shared';
import Link from 'next/link';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Alert, formatDate } from '@/components/ui';
import { api, errorMessage, uploadAttachment } from '@/lib/api';
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

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setBusy(true);
    setError('');
    try {
      for (const file of files) await uploadAttachment(pageId, file);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      await list.reload();
    }
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
                  {a.preview === 'pdf' ? 'PDF' : (a.filename.split('.').pop() ?? '').slice(0, 5).toUpperCase() || 'DATEI'}
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
        {canEdit && (
          <p className="row">
            <input ref={input} type="file" multiple hidden onChange={upload} data-testid="attachment-input" />
            <button className="small" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Wird hochgeladen …' : 'Datei hochladen'}
            </button>
          </p>
        )}
        <Alert>{error}</Alert>
      </details>
    </aside>
  );
}
