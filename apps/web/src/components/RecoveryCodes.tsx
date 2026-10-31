'use client';

import { useState } from 'react';
import { CopyButtons } from './CopyButtons';
import { Card } from './ui';

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const host = typeof window === 'undefined' ? '' : window.location.host;
  const text = [`Wiederherstellungscodes für das Wiki ${host}`.trim(), 'Jeder Code funktioniert genau einmal.', '', ...codes, ''].join('\n');
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
      <p>
        <CopyButtons text={text} label="Codes kopieren" filename="wiki-wiederherstellungscodes.txt" />
      </p>
      <p className="muted">Die Datei am besten im Passwortmanager ablegen und danach löschen.</p>
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
