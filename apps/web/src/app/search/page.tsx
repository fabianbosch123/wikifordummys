'use client';

import type { SearchHitDto, SearchResultDto, SpaceDto } from '@wiki/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { Alert, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';

function Snippet({ parts }: { parts: SearchHitDto['snippet'] }) {
  if (parts.length === 0) return null;
  // Treffer als <mark>, alles andere als Text; kein HTML aus der Datenbank (S6)
  return <p className="muted">{parts.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>;
}

function Search() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') ?? '';
  const space = params.get('space') ?? '';
  const spaces = useApiData<SpaceDto[]>('/spaces');
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<SearchHitDto[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setInput(q), [q]);

  useEffect(() => {
    setResults(null);
    setError('');
    if (!q.trim()) return;
    const query = new URLSearchParams({ q, ...(space ? { space } : {}) });
    api<SearchResultDto>(`/search?${query}`)
      .then((r) => {
        setResults(r.results);
        setHasMore(r.hasMore);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [q, space]);

  async function more() {
    const query = new URLSearchParams({ q, offset: String(results?.length ?? 0), ...(space ? { space } : {}) });
    try {
      const r = await api<SearchResultDto>(`/search?${query}`);
      setResults([...(results ?? []), ...r.results]);
      setHasMore(r.hasMore);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function go(nextSpace: string) {
    router.push(`/search?${new URLSearchParams({ q: input, ...(nextSpace ? { space: nextSpace } : {}) })}`);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go(space);
  }

  return (
    <>
      <h1>Suche</h1>
      <form onSubmit={submit} role="search" className="card">
        <div className="row">
          <label htmlFor="search-q" className="visually-hidden">
            Suchbegriff
          </label>
          <input id="search-q" type="search" required maxLength={200} value={input} onChange={(e) => setInput(e.target.value)} style={{ flex: 1 }} />
          <label htmlFor="search-space" className="visually-hidden">
            Space
          </label>
          <select
            id="search-space"
            value={space}
            onChange={(e) => go(e.target.value)}
          >
            <option value="">Alle Spaces</option>
            {spaces.data?.map((s) => (
              <option key={s.id} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit">Suchen</button>
        </div>
      </form>
      <Alert>{error}</Alert>
      {q && !results && !error && <p className="muted">Suche …</p>}
      {results?.length === 0 && <p className="muted">Keine Treffer für „{q}“.</p>}
      {results && results.length > 0 && (
        <ul className="search-results" aria-label="Suchergebnisse">
          {results.map((r) => (
            <li key={r.id}>
              <Link className="title" href={`/pages/${r.id}`}>
                {r.title}
              </Link>{' '}
              <span className="badge">{r.spaceKey}</span>
              <Snippet parts={r.snippet} />
              <small className="muted">
                {r.spaceName} · geändert {formatDate(r.updatedAt)}
              </small>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <p>
          <button className="secondary" onClick={more}>
            Weitere Treffer
          </button>
        </p>
      )}
    </>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      {() => (
        <Suspense fallback={<p className="muted">Lade …</p>}>
          <Search />
        </Suspense>
      )}
    </RequireAuth>
  );
}
