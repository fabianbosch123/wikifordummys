'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { pathForStage, useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/nav';

function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, refresh } = useAuth();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state || state.stage === 'password') return;
    router.replace(state.stage === 'full' ? safeNext(params.get('next')) : pathForStage(state.stage));
  }, [state, router, params]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/2fa', { method: 'POST', body: { code: code.trim() } });
      // Die Weiterleitung übernimmt der Effekt oben, sobald die Sitzung vollständig ist
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      // Abgelaufene halbe Anmeldung: zurück zum Login
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        const next = await refresh();
        if (next.stage !== 'password') router.replace('/login');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Zwei-Faktor-Anmeldung</h1>
      <Card>
        <form onSubmit={submit}>
          {useRecovery ? (
            <Field
              label="Wiederherstellungscode"
              autoComplete="off"
              placeholder="xxxx-xxxx-xxxx"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          ) : (
            <Field
              label="Code aus der Authenticator-App"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          )}
          <Alert>{error}</Alert>
          <button type="submit" disabled={busy}>
            Anmelden
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode('');
            }}
          >
            {useRecovery ? 'Code aus der App verwenden' : 'Kein Zugriff auf die App? Wiederherstellungscode verwenden'}
          </button>
        </form>
      </Card>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
