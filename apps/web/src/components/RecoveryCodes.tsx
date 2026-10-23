'use client';

import { useState } from 'react';
import { Card } from './ui';

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Card title="Wiederherstellungscodes">
      <p>
        Bewahre diese Codes sicher auf, z. B. im Passwortmanager oder ausgedruckt. Jeder Code funktioniert genau einmal, falls du
        keinen Zugriff auf deine Authenticator-App hast. Sie werden nur jetzt angezeigt.
      </p>
      <ul className="codes" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <label className="row">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Ich habe die Codes gesichert.
      </label>
      <p />
      <button disabled={!confirmed} onClick={onDone}>
        Weiter
      </button>
    </Card>
  );
}
