'use client';

import { SYSTEM_GROUPS, type DirectoryDto, type SpaceDto, type SpacePermissionDto, type SpaceRole, type SubjectDto } from '@wiki/shared';
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

/** Anzeigereihenfolge von wenig zu viel Recht, damit „Space-Admin“ nicht der erste Treffer im Auswahlfeld ist (Rundgang 2, N-2) */
const ROLE_ORDER: readonly SpaceRole[] = ['viewer', 'editor', 'admin'];

/**
 * Rückfrage, bevor eine Gruppe oder Person Space-Admin wird. Bei „alle-benutzer“ ausdrücklich, dass damit jedes Konto
 * den Space verwalten kann. Gibt false zurück, wenn abgebrochen wurde.
 */
function confirmAdminGrant(subject: SubjectDto, spaceName: string): boolean {
  const everyone = subject.type === 'group' && subject.name === SYSTEM_GROUPS.ALL_USERS;
  const who = everyone ? 'JEDES aktive Konto im Wiki (Gruppe alle-benutzer)' : subjectLabel(subject);
  return window.confirm(
    `${who} wirklich zum Space-Admin von „${spaceName}“ machen?\n\n` +
      'Space-Admins können Rollen vergeben und entziehen, Einschränkungen umgehen, Seiten endgültig aus dem Papierkorb löschen ' +
      'und den Space archivieren.' +
      (everyone ? '\n\nDamit gehört der Space praktisch allen. Für normales Bearbeiten reicht die Rolle „Bearbeiter“.' : ''),
  );
}

function RoleSelect({ value, onChange, label, disabled }: { value: SpaceRole; onChange: (role: SpaceRole) => void; label: string; disabled?: boolean }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as SpaceRole)}>
      {ROLE_ORDER.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

/**
 * Rollen im Space für Gruppen und Personen. Jede Änderung (Hinzufügen, Rolle ändern, Entfernen) wird sofort gespeichert,
 * damit niemand glaubt, eine Kollegin habe schon Zugriff, obwohl die Zeile nur in der Liste steht.
 */
export function SpacePermissions({ space }: { space: SpaceDto }) {
  const saved = useApiData<SpacePermissionDto[]>(`/spaces/${space.key}/permissions`);
  const directory = useApiData<DirectoryDto>('/directory');
  const [entries, setEntries] = useState<SpacePermissionDto[]>([]);
  const [newRole, setNewRole] = useState<SpaceRole>('editor');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (saved.data) setEntries(saved.data);
  }, [saved.data]);

  /** Speichert die ganze Liste; schlägt das fehl, bleibt der zuletzt gespeicherte Stand stehen */
  async function change(next: SpacePermissionDto[], done: string) {
    const previous = entries;
    setEntries(next);
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await api<SpacePermissionDto[]>(`/spaces/${space.key}/permissions`, {
        method: 'PUT',
        body: { entries: next.map((e) => ({ type: e.subject.type, id: e.subject.id, role: e.role })) },
      });
      setEntries(result);
      saved.setData(result);
      setMessage(done);
    } catch (err) {
      setEntries(previous);
      setError(`${errorMessage(err)} Die Rollen sind unverändert.`);
    } finally {
      setBusy(false);
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
                    disabled={busy}
                    onChange={(role) => {
                      // Ohne Bestätigung bleibt das Auswahlfeld auf der alten Rolle, gespeichert wird nichts
                      if (role === 'admin' && e.role !== 'admin' && !confirmAdminGrant(e.subject, space.name)) return;
                      void change(
                        entries.map((x, j) => (j === i ? { ...x, role } : x)),
                        `Gespeichert: ${subjectLabel(e.subject)} ist jetzt ${ROLE_LABELS[role]}.`,
                      );
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="small danger"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Rolle von ${subjectLabel(e.subject)} entfernen? Ohne Rolle sieht ${e.subject.type === 'group' ? 'die Gruppe' : 'die Person'} den Space nicht mehr.`)) return;
                      void change(
                        entries.filter((_, j) => j !== i),
                        `Gespeichert: ${subjectLabel(e.subject)} hat keine Rolle mehr.`,
                      );
                    }}
                  >
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
        onAdd={(subject) => {
          if (newRole === 'admin' && !confirmAdminGrant(subject, space.name)) return false;
          void change([...entries, { subject, role: newRole }], `Gespeichert: ${subjectLabel(subject)} ist jetzt ${ROLE_LABELS[newRole]}.`);
        }}
      >
        <RoleSelect label="Rolle für neuen Eintrag" value={newRole} onChange={setNewRole} />
      </SubjectPicker>
      <p className="muted">Änderungen gelten sofort, ein eigenes Speichern ist nicht nötig.</p>
      <Alert kind="success">{message}</Alert>
      <Alert>{error}</Alert>
    </Card>
  );
}
