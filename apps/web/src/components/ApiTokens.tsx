'use client';

import {
  API_TOKEN_LIFETIMES_DAYS,
  API_TOKEN_NAME_MAX_LENGTH,
  type ApiTokenDto,
  type ApiTokenScope,
  type CreatedApiTokenDto,
  type MyApiTokensDto,
} from '@wiki/shared';
import { FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { Alert, Card, Field, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export const SCOPE_LABEL: Record<ApiTokenScope, string> = {
  read: 'Nur lesen',
  write: 'Lesen und schreiben',
};

export function TokenStatus({ token }: { token: ApiTokenDto }) {
  if (token.status === 'revoked') return <span className="badge warn">widerrufen</span>;
  if (token.status === 'expired') return <span className="badge">abgelaufen</span>;
  return <span className="badge ok">aktiv</span>;
}

/** Name eines Tokens; per OAuth verbundene Anwendungen (z. B. claude.ai) ohne Präfix, das wechselt bei jeder Erneuerung */
export function TokenName({ token }: { token: ApiTokenDto }) {
  return (
    <>
      {token.name} {token.client ? <span className="badge">Connector (OAuth)</span> : <code>{token.prefix}…</code>} <TokenStatus token={token} />
    </>
  );
}

/** Befehl für Claude Code; das Token steht nur in der Kopie, die der Benutzer einmal sieht */
function claudeCodeCommand(endpoint: string, token: string) {
  return `claude mcp add --transport http wiki ${endpoint} --header "Authorization: Bearer ${token}"`;
}

/** API-Tokens für Claude (MCP-Server) im Profil: anlegen (mit 2FA-Code), ansehen, widerrufen */
export function ApiTokens() {
  const scopeId = useId();
  const lifetimeId = useId();
  const [data, setData] = useState<MyApiTokensDto | null>(null);
  // Standard „Nur lesen“: Liest Claude präparierte Seiten, kann es so nichts ändern (SEC-006)
  const [form, setForm] = useState({ name: '', scope: 'read' as ApiTokenScope, expiresInDays: 90, code: '' });
  const [created, setCreated] = useState<CreatedApiTokenDto | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<MyApiTokensDto>('/me/tokens').then(setData, (err) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      setCreated(await api<CreatedApiTokenDto>('/me/tokens', { method: 'POST', body: form }));
      setForm({ ...form, name: '', code: '' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function revoke(t: ApiTokenDto) {
    if (!window.confirm(`Token „${t.name}“ widerrufen? Claude kann damit danach nicht mehr auf das Wiki zugreifen.`)) return;
    try {
      await api(`/me/tokens/${t.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!data) return null;
  if (!data.enabled && data.tokens.length === 0) return null;

  return (
    <Card title="Claude und andere KI-Assistenten (MCP)">
      <p className="muted">
        Mit einem API-Token kann Claude über den MCP-Server des Wikis Seiten und Zeichnungen lesen und anlegen, und zwar mit genau deinen
        Rechten. Jede Änderung steht mit deinem Namen in der Versionsgeschichte und im Audit-Log. Adresse des MCP-Servers:{' '}
        <code>{data.endpoint}</code>
      </p>
      <p className="muted">
        In claude.ai (Web, App, Projekte) fügst du das Wiki unter Einstellungen → Connectors als eigenen Connector mit dieser Adresse hinzu. Ein Token
        brauchst du dafür nicht: Claude leitet dich zur Anmeldung ins Wiki, und die Verbindung erscheint danach hier in der Liste.
      </p>
      {!data.enabled && <Alert kind="info">Der MCP-Zugang ist in der Administration ausgeschaltet; vorhandene Tokens funktionieren gerade nicht.</Alert>}

      {created && (
        <div>
          <Alert kind="success">Token angelegt. Kopiere es jetzt, es wird nur dieses eine Mal angezeigt.</Alert>
          <Field label="Token" readOnly value={created.token} onFocus={(e) => e.target.select()} />
          <Field label="Für Claude Code" readOnly value={claudeCodeCommand(data.endpoint, created.token)} onFocus={(e) => e.target.select()} />
          <p className="muted">Anleitung für Claude Desktop und weitere Clients: docs/mcp.md im Repository.</p>
          <div className="row">
            <button type="button" className="secondary" onClick={() => setCreated(null)}>
              Fertig, Token ist gesichert
            </button>
          </div>
        </div>
      )}

      {data.tokens.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Rechte</th>
                <th>Gültig bis</th>
                <th>Zuletzt verwendet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((t) => (
                <tr key={t.id}>
                  <td>
                    <TokenName token={t} />
                  </td>
                  <td>{SCOPE_LABEL[t.scope]}</td>
                  <td>{formatDate(t.expiresAt)}</td>
                  <td>{t.lastUsedAt ? `${formatDate(t.lastUsedAt)} (${t.lastUsedIp})` : 'nie'}</td>
                  <td>
                    {t.status === 'active' && (
                      <button className="small danger" onClick={() => revoke(t)}>
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

      {data.enabled && (
        <form onSubmit={submit}>
          <h3>Neues Token</h3>
          <Field
            label="Name"
            required
            maxLength={API_TOKEN_NAME_MAX_LENGTH}
            placeholder="z. B. Claude Desktop Laptop"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="field">
            <label htmlFor={scopeId}>Rechte</label>
            <select id={scopeId} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as ApiTokenScope })}>
              <option value="read">{SCOPE_LABEL.read}</option>
              <option value="write">{SCOPE_LABEL.write}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={lifetimeId}>Gültig für</label>
            <select id={lifetimeId} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}>
              {API_TOKEN_LIFETIMES_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} Tage
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Code aus der App"
            hint="Zur Bestätigung, dass wirklich du das Token anlegst"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })}
          />
          <div className="row">
            <button type="submit">Token anlegen</button>
          </div>
        </form>
      )}
      <Alert>{error}</Alert>
    </Card>
  );
}
