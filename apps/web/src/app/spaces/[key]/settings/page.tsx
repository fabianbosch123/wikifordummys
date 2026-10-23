'use client';

import type { SpaceDto } from '@wiki/shared';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { SpaceLayout } from '@/components/SpaceLayout';
import { SpacePermissions } from '@/components/SpacePermissions';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';

function SettingsForm({ space }: { space: SpaceDto }) {
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [status, setStatus] = useState(space.status);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setStatus(space.status), [space.status]);

  async function patch(body: Partial<Pick<SpaceDto, 'name' | 'description' | 'status'>>, done: string) {
    setError('');
    setMessage('');
    try {
      const updated = await api<SpaceDto>(`/spaces/${space.key}`, { method: 'PATCH', body });
      setStatus(updated.status);
      setMessage(done);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void patch({ name, description }, 'Gespeichert.');
  }

  if (space.role !== 'admin') return <Alert>Nur Space-Admins können die Einstellungen ändern.</Alert>;

  return (
    <>
      <h1>Space-Einstellungen</h1>
      <Card>
        <form onSubmit={save}>
          <Field label="Schlüssel" value={space.key} disabled readOnly />
          <Field label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Beschreibung" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="row">
            <button type="submit">Speichern</button>
          </div>
        </form>
      </Card>
      <SpacePermissions space={space} />
      <Card title="Archivieren">
        <p className="muted">
          Archivierte Spaces bleiben lesbar, können aber nicht mehr bearbeitet werden und erscheinen in der Übersicht nur unter „Archiv“.
        </p>
        {status === 'active' ? (
          <button className="danger" onClick={() => patch({ status: 'archived' }, 'Der Space ist archiviert.')}>
            Space archivieren
          </button>
        ) : (
          <button onClick={() => patch({ status: 'active' }, 'Der Space ist wieder aktiv.')}>Archivierung aufheben</button>
        )}
      </Card>
      <Alert kind="success">{message}</Alert>
      <Alert>{error}</Alert>
    </>
  );
}

function Settings() {
  const { key } = useParams<{ key: string }>();
  return <SpaceLayout spaceKey={key}>{(space) => <SettingsForm space={space} />}</SpaceLayout>;
}

export default function Page() {
  return <RequireAuth>{() => <Settings />}</RequireAuth>;
}
