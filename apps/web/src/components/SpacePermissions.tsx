'use client';

import { SPACE_ROLES, type DirectoryDto, type SpaceDto, type SpacePermissionDto, type SpaceRole } from '@wiki/shared';
import { useEffect, useState } from 'react';
import { SubjectPicker, subjectLabel } from '@/components/SubjectPicker';
import { Alert, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApiData } from '@/lib/data';

export const ROLE_LABELS: Record<SpaceRole, string> = {
  admin: 'Space-Admin',
  editor: 'Bearbeiter',
  viewer: 'Leser',
};

function RoleSelect({ value, onChange, label }: { value: SpaceRole; onChange: (role: SpaceRole) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as SpaceRole)}>
      {SPACE_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

/** Rollen im Space für Gruppen und Personen; gespeichert wird die ganze Liste auf einmal */
export function SpacePermissions({ space }: { space: SpaceDto }) {
  const saved = useApiData<SpacePermissionDto[]>(`/spaces/${space.key}/permissions`);
  const directory = useApiData<DirectoryDto>('/directory');
  const [entries, setEntries] = useState<SpacePermissionDto[]>([]);
  const [newRole, setNewRole] = useState<SpaceRole>('editor');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (saved.data) setEntries(saved.data);
  }, [saved.data]);

  function change(next: SpacePermissionDto[]) {
    setEntries(next);
    setDirty(true);
    setMessage('');
  }

  async function save() {
    setError('');
    try {
      const result = await api<SpacePermissionDto[]>(`/spaces/${space.key}/permissions`, {
        method: 'PUT',
        body: { entries: entries.map((e) => ({ type: e.subject.type, id: e.subject.id, role: e.role })) },
      });
      setEntries(result);
      setDirty(false);
      setMessage('Rollen gespeichert.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (saved.error) return <Alert>{errorMessage(saved.error)}</Alert>;
  if (!saved.data || !directory.data) return <p className="muted">Lade Rollen …</p>;

  return (
    <Card title="Rollen">
      <p className="muted">
        Leser sehen die Seiten, Bearbeiter legen Seiten an, ändern sie und laden Anhänge hoch, Space-Admins verwalten zusätzlich
        Einstellungen, Rollen und den Papierkorb. Wer keine Rolle hat, sieht den Space nicht. Die Gruppe „alle-benutzer“ umfasst alle aktiven
        Konten; Systemadministratoren haben immer Zugriff.
      </p>
      <div className="table-wrap">
        <table>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.subject.type}:${e.subject.id}`}>
                <td>{subjectLabel(e.subject)}</td>
                <td>
                  <RoleSelect
                    label={`Rolle für ${subjectLabel(e.subject)}`}
                    value={e.role}
                    onChange={(role) => change(entries.map((x, j) => (j === i ? { ...x, role } : x)))}
                  />
                </td>
                <td>
                  <button type="button" className="small danger" onClick={() => change(entries.filter((_, j) => j !== i))}>
                    Entfernen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SubjectPicker
        directory={directory.data}
        exclude={entries.map((e) => e.subject)}
        onAdd={(subject) => change([...entries, { subject, role: newRole }])}
      >
        <RoleSelect label="Rolle für neuen Eintrag" value={newRole} onChange={setNewRole} />
      </SubjectPicker>
      <p />
      <div className="row">
        <button type="button" disabled={!dirty} onClick={save}>
          Rollen speichern
        </button>
      </div>
      <p />
      <Alert kind="success">{message}</Alert>
      <Alert>{error}</Alert>
    </Card>
  );
}
