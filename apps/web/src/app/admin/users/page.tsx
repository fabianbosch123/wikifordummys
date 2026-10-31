'use client';

import type { AdminUserDto, GroupDto } from '@wiki/shared';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CopyButtons } from '@/components/CopyButtons';
import { Alert, Card, Field, formatDate } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const STATUS_LABEL = { invited: 'eingeladen', active: 'aktiv', deactivated: 'deaktiviert' } as const;

function InviteForm({ groups, onInvited }: { groups: GroupDto[]; onInvited: (link: string | null, email: string, again?: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  // Offene Einladung für die eingegebene Adresse: Konto-ID für „Erneut einladen“
  const [pendingId, setPendingId] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setDisplayName('');
    setGroupIds([]);
    setPendingId(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setPendingId(null);
    try {
      const res = await api<{ inviteUrl: string | null; user: AdminUserDto }>('/admin/users', {
        method: 'POST',
        body: { email, displayName, groupIds },
      });
      onInvited(res.inviteUrl, res.user.email);
      reset();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_INVITED' && err.body?.error.userId) setPendingId(err.body.error.userId);
      setError(errorMessage(err));
    }
  }

  async function reinvite(id: string) {
    setError('');
    try {
      const res = await api<{ inviteUrl: string | null }>(`/admin/users/${encodeURIComponent(id)}/invite`, { method: 'POST' });
      onInvited(res.inviteUrl, email, true);
      reset();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const assignable = groups.filter((g) => g.name !== 'alle-benutzer');
  return (
    <Card title="Benutzer einladen">
      <form onSubmit={submit}>
        <Field label="E-Mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Anzeigename" required maxLength={100} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {assignable.length > 0 && (
          <fieldset className="row" style={{ border: 0, padding: 0 }}>
            <legend className="muted">Gruppen</legend>
            {assignable.map((g) => (
              <label key={g.id} className="row">
                <input
                  type="checkbox"
                  checked={groupIds.includes(g.id)}
                  onChange={(e) => setGroupIds(e.target.checked ? [...groupIds, g.id] : groupIds.filter((id) => id !== g.id))}
                />
                {g.name}
              </label>
            ))}
          </fieldset>
        )}
        <Alert>{error}</Alert>
        {pendingId && (
          <p className="row">
            <button type="button" className="small" onClick={() => reinvite(pendingId)}>
              Erneut einladen
            </button>
            <span className="muted">Der bisherige Einladungslink wird dabei ungültig.</span>
          </p>
        )}
        <div className="row">
          <button type="submit">Einladung senden</button>
        </div>
      </form>
    </Card>
  );
}

export default function AdminUsersPage() {
  const { state } = useAuth();
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; link?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, g] = await Promise.all([api<AdminUserDto[]>('/admin/users'), api<GroupDto[]>('/admin/groups')]);
      setUsers(u);
      setGroups(g);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, success: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError('');
    try {
      const res = (await fn()) as { inviteUrl?: string | null } | undefined;
      setNotice({ text: success, link: res?.inviteUrl ?? undefined });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? '?';
  const me = state?.user?.id;

  return (
    <>
      <InviteForm
        groups={groups}
        onInvited={(link, email, again) => {
          const what = again ? 'Neue Einladung' : 'Einladung';
          setNotice({
            text: link ? `${what} für ${email} angelegt. Es ist kein Mailserver eingerichtet, bitte den Link selbst weitergeben:` : `${what} an ${email} verschickt.`,
            link: link ?? undefined,
          });
          void load();
        }}
      />
      {notice && (
        <Alert kind="success">
          {notice.text}{' '}
          {notice.link && (
            <>
              <code data-testid="invite-link">{notice.link}</code> <CopyButtons text={notice.link} label="Link kopieren" />
            </>
          )}
        </Alert>
      )}
      <Alert>{error}</Alert>
      <p />
      <Card title={`Benutzer (${users.length})`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Gruppen</th>
                <th>Letzter Login</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.displayName}</strong>
                    <br />
                    <span className="muted">{u.email}</span>
                  </td>
                  <td>
                    <span className={`badge ${u.status === 'active' ? 'ok' : u.status === 'deactivated' ? 'warn' : ''}`}>{STATUS_LABEL[u.status]}</span>{' '}
                    {u.status === 'active' && !u.totpEnabled && <span className="badge warn">2FA fehlt</span>}
                  </td>
                  <td>{u.groupIds.map(groupName).join(', ') || <span className="muted">–</span>}</td>
                  <td>{formatDate(u.lastLoginAt)}</td>
                  <td>
                    <div className="row">
                      {u.status === 'invited' && (
                        <button className="small secondary" onClick={() => act(() => api(`/admin/users/${u.id}/invite`, { method: 'POST' }), `Neue Einladung für ${u.email} erstellt.`)}>
                          Erneut einladen
                        </button>
                      )}
                      {u.status !== 'invited' && u.id !== me && (
                        <button
                          className="small secondary"
                          onClick={() =>
                            act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isAdmin: !u.isAdmin } }), u.isAdmin ? 'Adminrechte entzogen.' : 'Adminrechte vergeben.')
                          }
                        >
                          {u.isAdmin ? 'Admin entziehen' : 'Zum Admin machen'}
                        </button>
                      )}
                      {u.status === 'active' && u.totpEnabled && (
                        <button
                          className="small secondary"
                          onClick={() =>
                            act(
                              () => api(`/admin/users/${u.id}/reset-2fa`, { method: 'POST' }),
                              '2FA zurückgesetzt. Beim nächsten Login wird sie neu eingerichtet.',
                              `2FA von ${u.email} wirklich zurücksetzen? Nur tun, wenn die Identität geprüft ist.`,
                            )
                          }
                        >
                          2FA zurücksetzen
                        </button>
                      )}
                      {u.status === 'active' && (
                        <button className="small secondary" onClick={() => act(() => api(`/admin/users/${u.id}/sessions`, { method: 'DELETE' }), 'Alle Sitzungen beendet.')}>
                          Sitzungen beenden
                        </button>
                      )}
                      {u.status === 'active' && u.id !== me && (
                        <button
                          className="small danger"
                          onClick={() =>
                            act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: 'deactivated' } }), `${u.email} deaktiviert.`, `${u.email} deaktivieren?`)
                          }
                        >
                          Deaktivieren
                        </button>
                      )}
                      {u.status === 'deactivated' && (
                        <button className="small secondary" onClick={() => act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: 'active' } }), `${u.email} reaktiviert.`)}>
                          Reaktivieren
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
