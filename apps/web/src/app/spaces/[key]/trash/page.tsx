'use client';

import type { TrashEntryDto } from '@wiki/shared';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { SpaceLayout } from '@/components/SpaceLayout';
import { Alert, Card, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';

function Trash() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const trash = useApiData<TrashEntryDto[]>(`/spaces/${encodeURIComponent(key)}/trash`);
  const [error, setError] = useState('');

  async function restore(entry: TrashEntryDto) {
    setError('');
    try {
      await api(`/pages/${entry.id}/undelete`, { method: 'POST' });
      router.push(`/pages/${entry.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <SpaceLayout spaceKey={key}>
      <h1>Papierkorb</h1>
      <p className="muted">Gelöschte Seiten bleiben 30 Tage hier und werden danach endgültig entfernt.</p>
      {trash.error && <Alert>{errorMessage(trash.error)}</Alert>}
      <Alert>{error}</Alert>
      {trash.data?.length === 0 && <p className="muted">Der Papierkorb ist leer.</p>}
      {trash.data && trash.data.length > 0 && (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Seite</th>
                  <th>Gelöscht</th>
                  <th>Endgültig gelöscht ab</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trash.data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.title}
                      {t.descendants > 0 && <span className="muted"> (mit {t.descendants} Unterseite{t.descendants === 1 ? '' : 'n'})</span>}
                    </td>
                    <td>
                      {formatDate(t.deletedAt)}
                      <br />
                      <span className="muted">{t.deletedBy?.displayName ?? '–'}</span>
                    </td>
                    <td>{formatDate(t.purgeAt)}</td>
                    <td>
                      <button className="small" onClick={() => restore(t)}>
                        Wiederherstellen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </SpaceLayout>
  );
}

export default function Page() {
  return <RequireAuth>{() => <Trash />}</RequireAuth>;
}
