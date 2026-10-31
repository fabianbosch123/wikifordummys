'use client';

import { checkPasswordPolicy, describeUserAgent, THEME_PREFERENCES, type MeDto, type SessionInfoDto } from '@wiki/shared';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiTokens } from '@/components/ApiTokens';
import { RecoveryCodes } from '@/components/RecoveryCodes';
import { Alert, Card, Field, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { RequireAuth, useAuth } from '@/lib/auth';
import { setFlash } from '@/lib/flash';
import { THEME_LABELS } from '@/lib/theme';

function ProfileForm({ user }: { user: MeDto }) {
  const { refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/me', { method: 'PATCH', body: { displayName } });
      await refresh();
      setMsg({ kind: 'success', text: 'Gespeichert.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  return (
    <Card title="Profil">
      <form onSubmit={submit}>
        <Field label="E-Mail" value={user.email} disabled />
        <Field label="Anzeigename" required maxLength={100} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="row">
          <button type="submit">Speichern</button>
        </div>
      </form>
    </Card>
  );
}

const THEME_HINTS = {
  system: 'wie im Betriebssystem bzw. Browser eingestellt',
  light: 'helle Flächen, dunkle Schrift',
  dark: 'dunkle Flächen, helle Schrift',
} as const;

/** Hell, dunkel oder System; gespeichert im Konto, gilt also auf allen Geräten */
function ThemeCard({ user }: { user: MeDto }) {
  const { setTheme } = useAuth();
  const [error, setError] = useState('');

  return (
    <Card title="Darstellung">
      <fieldset className="choices">
        <legend className="visually-hidden">Darstellung</legend>
        {THEME_PREFERENCES.map((theme) => (
          <label key={theme} className="check">
            <input
              type="radio"
              name="theme"
              value={theme}
              checked={user.theme === theme}
              onChange={() => {
                setError('');
                setTheme(theme).catch((err) => setError(errorMessage(err)));
              }}
            />
            <span>
              {THEME_LABELS[theme]} <span className="muted">– {THEME_HINTS[theme]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Alert>{error}</Alert>
    </Card>
  );
}

function PasswordForm({ user, onChanged }: { user: MeDto; onChanged: () => Promise<void> | void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkPasswordPolicy(next, user.email);
    if (problem) return setMsg({ kind: 'error', text: problem });
    if (next !== repeat) return setMsg({ kind: 'error', text: 'Die Passwörter stimmen nicht überein.' });
    try {
      await api('/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setRepeat('');
      setMsg({ kind: 'success', text: 'Passwort geändert. Alle anderen Geräte wurden abgemeldet.' });
      await onChanged();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  return (
    <Card title="Passwort ändern">
      <form onSubmit={submit}>
        <Field label={user.mustChangePassword ? 'Startpasswort' : 'Aktuelles Passwort'} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Field label="Neues Passwort" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        <Field label="Neues Passwort wiederholen" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="row">
          <button type="submit">Passwort ändern</button>
        </div>
      </form>
    </Card>
  );
}

function Sessions({ reloadKey }: { reloadKey: number }) {
  const [sessions, setSessions] = useState<SessionInfoDto[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<SessionInfoDto[]>('/me/sessions')
      .then(setSessions)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load, reloadKey]);

  async function revoke(id?: string) {
    try {
      await api(id ? `/me/sessions/${id}` : '/me/sessions', { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Angemeldete Geräte">
      <Alert>{error}</Alert>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gerät</th>
              <th>IP</th>
              <th>Zuletzt aktiv</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <span title={s.userAgent}>{describeUserAgent(s.userAgent)}</span>{' '}
                  {s.current && <span className="badge ok">dieses Gerät</span>}
                </td>
                <td>{s.ip}</td>
                <td>{formatDate(s.lastSeenAt)}</td>
                <td>
                  {!s.current && (
                    <button className="small danger" onClick={() => revoke(s.id)}>
                      Abmelden
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sessions.length > 1 && (
        <p>
          <button className="secondary" onClick={() => revoke()}>
            Alle anderen Geräte abmelden
          </button>
        </p>
      )}
    </Card>
  );
}

function RecoveryCodesCard() {
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await api<{ recoveryCodes: string[] }>('/me/2fa/recovery-codes', { method: 'POST', body: { code } });
      setCodes(res.recoveryCodes);
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (codes) return <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;
  return (
    <Card title="Wiederherstellungscodes">
      <p className="muted">Neue Codes erzeugen; die bisherigen werden dabei ungültig. Zur Bestätigung den aktuellen Code aus der App eingeben.</p>
      <form onSubmit={submit}>
        <Field label="Code aus der App" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        <Alert>{error}</Alert>
        <div className="row">
          <button type="submit">Neue Codes erzeugen</button>
        </div>
      </form>
    </Card>
  );
}

export default function ProfilePage() {
  const { refresh } = useAuth();
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <RequireAuth>
      {(user) =>
        user.mustChangePassword ? (
          <>
            <h1>Neues Passwort festlegen</h1>
            <Alert kind="info">
              Du bist mit einem Startpasswort aus der Kommandozeile angemeldet. Bitte lege jetzt ein eigenes Passwort fest; vorher ist das
              Wiki nicht nutzbar.
            </Alert>
            <PasswordForm
              user={user}
              onChanged={async () => {
                // Das Formular verschwindet mit dem Wechsel; die Meldung erscheint deshalb auf der Startseite
                setFlash('Passwort geändert. Willkommen im Wiki!');
                await refresh();
                router.replace('/');
              }}
            />
          </>
        ) : (
          <>
            <h1>Mein Konto</h1>
            <ProfileForm user={user} />
            <ThemeCard user={user} />
            <PasswordForm user={user} onChanged={() => setReloadKey((k) => k + 1)} />
            <Sessions reloadKey={reloadKey} />
            <RecoveryCodesCard />
            <ApiTokens />
          </>
        )
      }
    </RequireAuth>
  );
}
