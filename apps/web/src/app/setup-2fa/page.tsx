'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { RecoveryCodes } from '@/components/RecoveryCodes';
import { Alert, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { pathForStage, useAuth } from '@/lib/auth';

interface SetupData {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export default function SetupTwoFactorPage() {
  const router = useRouter();
  const { state, refresh } = useAuth();
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state || codes) return;
    if (state.stage !== 'totp_setup') {
      router.replace(pathForStage(state.stage));
      return;
    }
    if (!setup) {
      api<SetupData>('/auth/2fa/setup', { method: 'POST' })
        .then(setSetup)
        .catch((err) => setError(errorMessage(err)));
    }
  }, [state, setup, codes, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ recoveryCodes: string[] }>('/auth/2fa/setup/confirm', { method: 'POST', body: { code } });
      setCodes(res.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <div className="narrow">
        <h1>Zwei-Faktor-Anmeldung eingerichtet</h1>
        <RecoveryCodes
          codes={codes}
          onDone={async () => {
            await refresh();
            router.replace('/');
          }}
        />
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>Zwei-Faktor-Anmeldung einrichten</h1>
      <Card>
        <p>
          Die Zwei-Faktor-Anmeldung ist für alle Konten Pflicht. Scanne den QR-Code mit einer Authenticator-App (z. B. Aegis,
          Google Authenticator, Microsoft Authenticator oder 1Password) und gib den angezeigten Code ein.
        </p>
        {setup ? (
          <>
            <img src={setup.qrDataUrl} alt="QR-Code für die Authenticator-App" width={220} height={220} />
            <p className="muted">
              Manuelle Eingabe: <code data-testid="totp-secret">{setup.secret}</code>
            </p>
          </>
        ) : (
          !error && <p className="muted">Lade …</p>
        )}
        <form onSubmit={submit}>
          <Field
            label="6-stelliger Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Alert>{error}</Alert>
          <button type="submit" disabled={busy || !setup}>
            Bestätigen
          </button>
        </form>
      </Card>
    </div>
  );
}
