'use client';

import { PASSWORD_MIN_LENGTH, checkPasswordPolicy } from '@wiki/shared';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { refresh } = useAuth();
  const [invite, setInvite] = useState<{ email: string; displayName: string } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ email: string; displayName: string }>(`/auth/invite/${encodeURIComponent(token)}`)
      .then((data) => {
        setInvite(data);
        setDisplayName(data.displayName);
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const problem = checkPasswordPolicy(password, invite?.email);
    if (problem) return setError(problem);
    if (password !== repeat) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      await api('/auth/invite/accept', { method: 'POST', body: { token, password, displayName } });
      await refresh();
      router.replace('/setup-2fa');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Einladung annehmen</h1>
      {loadError && <Alert>{loadError}</Alert>}
      {invite && (
        <Card>
          <p>
            Konto für <strong>{invite.email}</strong>. Lege dein Passwort fest; danach richtest du die Zwei-Faktor-Anmeldung ein.
          </p>
          <form onSubmit={submit}>
            <Field label="Anzeigename" required maxLength={100} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Field
              label="Passwort"
              type="password"
              autoComplete="new-password"
              required
              hint={`Mindestens ${PASSWORD_MIN_LENGTH} Zeichen. Ein Satz aus mehreren Wörtern ist gut zu merken.`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Field
              label="Passwort wiederholen"
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
            <Alert>{error}</Alert>
            <button type="submit" disabled={busy}>
              Konto anlegen
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}
