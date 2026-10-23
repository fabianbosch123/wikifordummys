'use client';

import type { PageDiffDto, PageDto, PageVersionDto, PageVersionSummaryDto } from '@wiki/shared';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { RichText } from '@/components/RichText';
import { SpaceLayout } from '@/components/SpaceLayout';
import { Alert, Card, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';

function DiffView({ diff }: { diff: PageDiffDto }) {
  return (
    <Card title={`Vergleich Version ${diff.from} → ${diff.to}`}>
      {diff.title.from !== diff.title.to && (
        <p>
          Titel: <del className="diff-removed">{diff.title.from}</del> → <ins className="diff-added">{diff.title.to}</ins>
        </p>
      )}
      <ol className="diff" aria-label="Unterschiede" data-testid="diff">
        {diff.lines.map((line, i) => (
          <li key={i} className={`diff-${line.type}`}>
            <span className="diff-sign" aria-hidden>
              {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
            </span>
            {line.type === 'added' ? <ins>{line.text || ' '}</ins> : line.type === 'removed' ? <del>{line.text || ' '}</del> : line.text || ' '}
          </li>
        ))}
      </ol>
      {diff.lines.every((l) => l.type === 'unchanged') && <p className="muted">Der Inhalt ist gleich.</p>}
    </Card>
  );
}

function History() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const page = useApiData<PageDto>(`/pages/${id}`);
  const versions = useApiData<PageVersionSummaryDto[]>(`/pages/${id}/versions`);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [diff, setDiff] = useState<PageDiffDto | null>(null);
  const [shown, setShown] = useState<PageVersionDto | null>(null);
  const [error, setError] = useState('');

  // Standard: die beiden neuesten Versionen vergleichen
  useEffect(() => {
    if (!versions.data || from !== null) return;
    setTo(versions.data[0]?.version ?? null);
    setFrom(versions.data[1]?.version ?? versions.data[0]?.version ?? null);
  }, [versions.data, from]);

  async function compare() {
    if (from === null || to === null) return;
    setError('');
    setShown(null);
    try {
      setDiff(await api<PageDiffDto>(`/pages/${id}/diff?from=${Math.min(from, to)}&to=${Math.max(from, to)}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function show(version: number) {
    setError('');
    setDiff(null);
    try {
      setShown(await api<PageVersionDto>(`/pages/${id}/versions/${version}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function restore(version: number) {
    if (!window.confirm(`Version ${version} wiederherstellen? Sie wird als neue Version gespeichert.`)) return;
    try {
      await api(`/pages/${id}/restore/${version}`, { method: 'POST' });
      router.push(`/pages/${id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (page.error) return <Alert>{errorMessage(page.error)}</Alert>;
  if (!page.data || !versions.data) return <p className="muted">Lade …</p>;
  const p = page.data;

  return (
    <SpaceLayout spaceKey={p.spaceKey} currentId={p.id}>
      <Breadcrumbs page={{ ...p, ancestors: [...p.ancestors, { id: p.id, title: p.title }] }} current="Verlauf" />
      <h1>Verlauf: {p.title}</h1>
      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Von</th>
                <th>Bis</th>
                <th>Version</th>
                <th>Titel</th>
                <th>Geändert</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.data.map((v) => (
                <tr key={v.version}>
                  <td>
                    <input type="radio" name="from" aria-label={`Von Version ${v.version}`} checked={from === v.version} onChange={() => setFrom(v.version)} />
                  </td>
                  <td>
                    <input type="radio" name="to" aria-label={`Bis Version ${v.version}`} checked={to === v.version} onChange={() => setTo(v.version)} />
                  </td>
                  <td>
                    {v.version}
                    {v.version === p.version && <> <span className="badge ok">aktuell</span></>}
                  </td>
                  <td>
                    {v.title}
                    {v.restoredFrom && <span className="muted"> (aus Version {v.restoredFrom})</span>}
                  </td>
                  <td>
                    {formatDate(v.createdAt)}
                    <br />
                    <span className="muted">{v.author?.displayName ?? '–'}</span>
                  </td>
                  <td>
                    <div className="row">
                      <button className="small secondary" onClick={() => show(v.version)}>
                        Ansehen
                      </button>
                      {p.canEdit && v.version !== p.version && (
                        <button className="small" onClick={() => restore(v.version)}>
                          Wiederherstellen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="row">
          <button className="small" onClick={compare} disabled={versions.data.length < 2}>
            Vergleichen
          </button>
        </p>
      </Card>
      <Alert>{error}</Alert>
      {diff && <DiffView diff={diff} />}
      {shown && (
        <Card title={`Version ${shown.version}: ${shown.title}`}>
          <RichText doc={shown.content} />
        </Card>
      )}
    </SpaceLayout>
  );
}

export default function Page() {
  return <RequireAuth>{() => <History />}</RequireAuth>;
}
