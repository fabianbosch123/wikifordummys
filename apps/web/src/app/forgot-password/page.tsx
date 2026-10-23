'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ message: string }>('/auth/password/forgot', { method: 'POST', body: { email } });
      setMessage(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Passwort vergessen</h1>
      <Card>
        {message ? (
          <Alert kind="success">{message}</Alert>
        ) : (
          <form onSubmit={submit}>
            <Field label="E-Mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Alert>{error}</Alert>
            <button type="submit" disabled={busy}>
              Link anfordern
            </button>
          </form>
        )}
      </Card>
      <Link href="/login">Zurück zur Anmeldung</Link>
    </div>
  );
}
