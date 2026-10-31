'use client';

import type { MeDto, SpaceDto } from '@wiki/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';
import { useFlash } from '@/lib/flash';

function CreateSpace() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const space = await api<SpaceDto>('/spaces', { method: 'POST', body: { key, name, description, open } });
      router.push(`/pages/${space.homePageId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card title="Space anlegen">
      <form onSubmit={submit}>
        <Field
          label="Schlüssel"
          required
          maxLength={10}
          placeholder="z. B. IT"
          hint="2 bis 10 Zeichen, Buchstaben und Ziffern; erscheint in Links und lässt sich später nicht ändern"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
        />
        <Field label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Beschreibung" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          Alle Benutzer dürfen lesen und bearbeiten (sonst nur du; weitere Rollen vergibst du in den Space-Einstellungen)
        </label>
        <Alert>{error}</Alert>
        <div className="row">
          <button type="submit" disabled={busy}>
            Space anlegen
          </button>
        </div>
      </form>
    </Card>
  );
}

function Spaces({ user }: { user: MeDto }) {
  const [archived, setArchived] = useState(false);
  const spaces = useApiData<SpaceDto[]>(`/spaces?status=${archived ? 'archived' : 'active'}`);
  const flash = useFlash();

  return (
    <>
      <h1>Willkommen, {user.displayName}</h1>
      {flash && <Alert kind="success">{flash}</Alert>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{archived ? 'Archivierte Spaces' : 'Spaces'}</h2>
        <button className="small secondary" onClick={() => setArchived(!archived)}>
          {archived ? 'Aktive Spaces anzeigen' : 'Archiv anzeigen'}
        </button>
      </div>
      <p />
      {spaces.error && <Alert>{errorMessage(spaces.error)}</Alert>}
      {spaces.data?.length === 0 && (
        <p className="muted">{archived ? 'Keine archivierten Spaces.' : 'Noch keine Spaces. Lege den ersten an.'}</p>
      )}
      <div className="space-grid">
        {spaces.data?.map((s) => (
          <Link key={s.id} href={s.homePageId ? `/pages/${s.homePageId}` : `/spaces/${s.key}`} className="space-card">
            <strong>{s.name}</strong> <span className="badge">{s.key}</span>
            {s.description && <span className="muted">{s.description}</span>}
          </Link>
        ))}
      </div>
      {user.canCreateSpace && !archived && <CreateSpace />}
    </>
  );
}

export default function HomePage() {
  return <RequireAuth>{(user) => <Spaces user={user} />}</RequireAuth>;
}
