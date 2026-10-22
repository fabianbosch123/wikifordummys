'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { pathForStage, useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/nav';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state?.authenticated) router.replace(safeNext(params.get('next')));
  }, [state, router, params]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      const next = await refresh();
      const target = pathForStage(next.stage);
      const query = params.get('next') ? `?next=${encodeURIComponent(safeNext(params.get('next')))}` : '';
      router.replace(target + query);
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Anmelden</h1>
      <Card>
        <form onSubmit={submit}>
          <Field label="E-Mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field
            label="Passwort"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Alert>{error}</Alert>
          <button type="submit" disabled={busy}>
            {busy ? 'Prüfe …' : 'Weiter'}
          </button>
          <Link href="/forgot-password" className="muted">
            Passwort vergessen?
          </Link>
        </form>
      </Card>
      <p className="muted">Ein Konto gibt es nur per Einladung durch einen Administrator.</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
