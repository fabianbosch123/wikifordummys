'use client';

import { checkPasswordPolicy, PASSWORD_MIN_LENGTH } from '@wiki/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const problem = checkPasswordPolicy(password);
    if (problem) return setError(problem);
    if (password !== repeat) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Neues Passwort</h1>
      <Card>
        {done ? (
          <>
            <Alert kind="success">Dein Passwort wurde geändert. Alle Geräte wurden abgemeldet.</Alert>
            <p>
              <Link href="/login">Jetzt anmelden</Link>
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field
              label="Neues Passwort"
              type="password"
              autoComplete="new-password"
              required
              hint={`Mindestens ${PASSWORD_MIN_LENGTH} Zeichen.`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Field label="Wiederholen" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            <Alert>{error}</Alert>
            <button type="submit" disabled={busy}>
              Passwort setzen
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
