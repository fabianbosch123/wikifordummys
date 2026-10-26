'use client';

import type { ApiAccessDto } from '@wiki/shared';
import { useCallback, useEffect, useState } from 'react';
import { SCOPE_LABEL, TokenStatus } from '@/components/ApiTokens';
import { Alert, Card, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

/** MCP-Server (Claude) ein- und ausschalten, API-Tokens aller Benutzer sehen und widerrufen */
export default function AdminApiPage() {
  const [data, setData] = useState<ApiAccessDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<ApiAccessDto>('/admin/api-access').then(setData, (err) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load]);

  async function toggle() {
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      setData(await api<ApiAccessDto>('/admin/api-access', { method: 'PUT', body: { enabled: !data.enabled } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Token „${name}“ widerrufen?`)) return;
    try {
      await api(`/admin/api-access/tokens/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!data) return <Alert>{error}</Alert>;

  return (
    <>
      <Card title="MCP-Server für Claude">
        <p>
          Über den MCP-Server können Claude und andere KI-Assistenten Seiten und Zeichnungen lesen, anlegen und ändern.{' '}
          <span className={data.enabled ? 'badge ok' : 'badge'}>{data.enabled ? 'eingeschaltet' : 'ausgeschaltet'}</span>
        </p>
        <p className="muted">
          Jeder Benutzer legt sich dafür im Profil ein eigenes API-Token an (mit 2FA-Code, höchstens ein Jahr gültig). Ein Token hat genau die
          Rechte seines Benutzers. Tipp: ein eigenes Konto für Claude anlegen und ihm nur in ausgewählten Spaces Rechte geben. Ausschalten
          sperrt alle Tokens sofort, ohne sie zu löschen. Adresse: <code>{data.endpoint}</code>
        </p>
        <div className="row">
          <button type="button" className={data.enabled ? 'danger' : ''} disabled={busy} onClick={toggle}>
            {data.enabled ? 'MCP-Server ausschalten' : 'MCP-Server einschalten'}
          </button>
        </div>
      </Card>
      <Card title="API-Tokens">
        {data.tokens.length === 0 ? (
          <p className="muted">Noch keine Tokens.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Benutzer</th>
                  <th>Name</th>
                  <th>Rechte</th>
                  <th>Angelegt</th>
                  <th>Gültig bis</th>
                  <th>Zuletzt verwendet</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.user.displayName}</td>
                    <td>
                      {t.name} <code>{t.prefix}…</code> <TokenStatus token={t} />
                    </td>
                    <td>{SCOPE_LABEL[t.scope]}</td>
                    <td>{formatDate(t.createdAt)}</td>
                    <td>{formatDate(t.expiresAt)}</td>
                    <td>{t.lastUsedAt ? `${formatDate(t.lastUsedAt)} (${t.lastUsedIp})` : 'nie'}</td>
                    <td>
                      {t.status === 'active' && (
                        <button className="small danger" onClick={() => revoke(t.id, t.name)}>
                          Widerrufen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Alert>{error}</Alert>
    </>
  );
}
