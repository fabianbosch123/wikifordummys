'use client';

import type { AttachmentDto, AttachmentVersionDto } from '@wiki/shared';
import Link from 'next/link';
import { ChangeEvent, useRef, useState } from 'react';
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

/** Anhänge einer Seite: Bilder mit Vorschau, PDF zum Öffnen im Browser, Office-Dokumente im Editor, alles andere zum Herunterladen */
export function Attachments({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const list = useApiData<AttachmentDto[]>(`/pages/${pageId}/attachments`);
  const input = useRef<HTMLInputElement>(null);
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

  if (list.error) return <Alert>{errorMessage(list.error)}</Alert>;

  return (
    <section className="attachments" aria-labelledby="attachments-title">
      <h2 id="attachments-title">Anhänge</h2>
      {list.data?.length === 0 && <p className="muted">Keine Anhänge.</p>}
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
    </section>
  );
}
