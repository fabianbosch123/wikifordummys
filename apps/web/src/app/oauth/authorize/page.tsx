'use client';

import { API_TOKEN_LIFETIMES_DAYS, type ApiTokenScope, type MeDto, type OAuthConsentInfoDto } from '@wiki/shared';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useId, useMemo, useState } from 'react';
import { SCOPE_LABEL } from '@/components/ApiTokens';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';

/** Parameter der Autorisierungsanfrage (RFC 6749, 4.1.1, mit PKCE und resource); alles andere bleibt hier */
const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const;

function Consent({ user }: { user: MeDto }) {
  const search = useSearchParams();
  const scopeId = useId();
  const lifetimeId = useId();
  const request = useMemo(() => {
    const r: Record<string, string> = {};
    for (const p of PARAMS) {
      const v = search.get(p);
      if (v !== null) r[p] = v;
    }
    return r;
  }, [search]);
  const [info, setInfo] = useState<OAuthConsentInfoDto | null>(null);
  const [form, setForm] = useState({ scope: 'write' as ApiTokenScope, expiresInDays: 90, code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<OAuthConsentInfoDto>(`/oauth/authorize/check?${new URLSearchParams(request)}`).then(
      (i) => {
        setInfo(i);
        setForm((f) => ({ ...f, scope: i.requestedScope }));
      },
      (err) => setError(errorMessage(err)),
    );
  }, [request]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError('');
    try {
      const body = approve ? { ...request, approve, scope_choice: form.scope, expiresInDays: form.expiresInDays, code: form.code } : { ...request, approve };
      const { redirect } = await api<{ redirect: string }>('/oauth/authorize', { method: 'POST', body });
      window.location.assign(redirect);
    } catch (err) {
      setError(errorMessage(err));
      setForm((f) => ({ ...f, code: '' }));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void decide(true);
  }

  if (!info) {
    return (
      <div className="narrow">
        <h1>Zugriff auf das Wiki</h1>
        {error ? <Alert>{error}</Alert> : <p className="muted">Lade …</p>}
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>Zugriff auf das Wiki</h1>
      <Card>
        <p>
          <strong>{info.clientName}</strong> möchte über den MCP-Server mit deinem Konto <strong>{user.displayName}</strong> ({user.email}) auf
          das Wiki zugreifen.
        </p>
        <Alert kind="info">
          Nach der Zustimmung geht es zurück zu <strong>{info.redirectHost}</strong>. Stimme nur zu, wenn du die Verbindung gerade selbst
          angestoßen hast, z. B. beim Hinzufügen des Wikis als Connector in Claude.
        </Alert>
        <p className="muted">
          Die Anwendung hat deine Rechte im Wiki (Spaces, Rollen, Einschränkungen). Löschen, Verschieben und Administration sind über MCP nicht
          möglich. Widerrufen kannst du den Zugriff jederzeit unter Mein Konto.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor={scopeId}>Rechte</label>
            <select id={scopeId} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as ApiTokenScope })}>
              <option value="write">{SCOPE_LABEL.write}</option>
              <option value="read">{SCOPE_LABEL.read}</option>
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
            hint="Zur Bestätigung, dass wirklich du zustimmst"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })}
          />
          <Alert>{error}</Alert>
          <div className="row">
            <button type="submit" disabled={busy}>
              Zulassen
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void decide(false)}>
              Ablehnen
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <RequireAuth>
      {(user) => (
        <Suspense>
          <Consent user={user} />
        </Suspense>
      )}
    </RequireAuth>
  );
}
