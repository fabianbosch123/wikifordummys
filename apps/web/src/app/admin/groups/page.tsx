'use client';

import type { AdminUserDto, GroupDto } from '@wiki/shared';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

function MembersEditor({ group, users, onSaved }: { group: GroupDto; users: AdminUserDto[]; onSaved: () => void }) {
  const [selected, setSelected] = useState<string[]>(group.memberIds);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    try {
      await api(`/admin/groups/${group.id}/members`, { method: 'PUT', body: { userIds: selected } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="row">
        {users
          .filter((u) => u.status !== 'deactivated')
          .map((u) => (
            <label key={u.id} className="row">
              <input
                type="checkbox"
                checked={selected.includes(u.id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, u.id] : selected.filter((id) => id !== u.id))}
              />
              {u.displayName}
            </label>
          ))}
      </div>
      <Alert>{error}</Alert>
      <p>
        <button className="small" onClick={save}>
          Mitglieder speichern
        </button>
      </p>
    </div>
  );
}

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [g, u] = await Promise.all([api<GroupDto[]>('/admin/groups'), api<AdminUserDto[]>('/admin/users')]);
      setGroups(g);
      setUsers(u);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/admin/groups', { method: 'POST', body: { name, description } });
      setName('');
      setDescription('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(group: GroupDto) {
    if (!window.confirm(`Gruppe ${group.name} löschen?`)) return;
    try {
      await api(`/admin/groups/${group.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.displayName ?? '?';

  return (
    <>
      <Card title="Gruppe anlegen">
        <form onSubmit={create}>
          <Field label="Name" required placeholder="z. B. team-it" hint="Kleinbuchstaben, Ziffern und Bindestriche" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Beschreibung" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="row">
            <button type="submit">Anlegen</button>
          </div>
        </form>
      </Card>
      <Alert>{error}</Alert>
      <p />
      {groups.map((g) => (
        <Card key={g.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>
              {g.name} {g.system && <span className="badge">System</span>}
            </h2>
            <div className="row">
              {g.name !== 'alle-benutzer' && (
                <button className="small secondary" onClick={() => setEditing(editing === g.id ? null : g.id)}>
                  {editing === g.id ? 'Schließen' : 'Mitglieder bearbeiten'}
                </button>
              )}
              {!g.system && (
                <button className="small danger" onClick={() => remove(g)}>
                  Löschen
                </button>
              )}
            </div>
          </div>
          {g.description && <p className="muted">{g.description}</p>}
          {g.name === 'alle-benutzer' ? (
            <p className="muted">Jedes aktive Konto gehört automatisch dazu.</p>
          ) : editing === g.id ? (
            <MembersEditor
              group={g}
              users={users}
              onSaved={() => {
                setEditing(null);
                void load();
              }}
            />
          ) : (
            <p>{g.memberIds.map(userName).join(', ') || <span className="muted">Keine Mitglieder</span>}</p>
          )}
        </Card>
      ))}
    </>
  );
}
