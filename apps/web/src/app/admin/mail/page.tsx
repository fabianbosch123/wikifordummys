'use client';

import type { MailSettingsDto, MailSettingsInput, SmtpSecurity } from '@wiki/shared';
import { FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { Alert, Card, Field, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const SECURITY: { value: SmtpSecurity; label: string; port: number }[] = [
  { value: 'tls', label: 'SSL/TLS (meist Port 465)', port: 465 },
  { value: 'starttls', label: 'STARTTLS (meist Port 587)', port: 587 },
  { value: 'none', label: 'Keine (nur im internen Netz)', port: 25 },
];

const SOURCE_TEXT: Record<MailSettingsDto['source'], string> = {
  admin: 'Die Einstellungen stammen aus der Administration und haben Vorrang vor der Datei .env.',
  env: 'Die Einstellungen stammen aus der Installation (Datei .env auf dem Server).',
  none: 'Es ist kein Mailserver eingerichtet. Einladungslinks werden in der Benutzerverwaltung angezeigt, „Passwort vergessen“ funktioniert nicht.',
};

export default function AdminMailPage() {
  const { state } = useAuth();
  const securityId = useId();
  const [current, setCurrent] = useState<MailSettingsDto | null>(null);
  const [form, setForm] = useState({ host: '', port: '587', security: 'starttls' as SmtpSecurity, username: '', password: '', from: '' });
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const apply = useCallback((s: MailSettingsDto) => {
    setCurrent(s);
    setForm({ host: s.host, port: String(s.port), security: s.security, username: s.username, password: '', from: s.from });
  }, []);

  useEffect(() => {
    api<MailSettingsDto>('/admin/settings/mail').then(apply, (err) => setError(errorMessage(err)));
  }, [apply]);

  useEffect(() => {
    if (state?.user) setTestTo((t) => t || state.user!.email);
  }, [state]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      setSuccess(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function save(e: Pick<FormEvent, 'preventDefault'>, skipVerify = false) {
    e.preventDefault();
    const body: MailSettingsInput = {
      host: form.host,
      port: Number(form.port),
      security: form.security,
      username: form.username,
      from: form.from,
      skipVerify,
    };
    if (form.password) body.password = form.password;
    void run(async () => {
      apply(await api<MailSettingsDto>('/admin/settings/mail', { method: 'PUT', body }));
      return skipVerify ? 'Gespeichert (ohne Prüfung der Verbindung).' : 'Verbindung geprüft und gespeichert.';
    });
  }

  function sendTest() {
    void run(async () => {
      const res = await api<{ to: string }>('/admin/settings/mail/test', { method: 'POST', body: { to: testTo } });
      return `Testmail an ${res.to} verschickt. Bitte im Postfach (auch im Spam-Ordner) nachsehen.`;
    });
  }

  function resetToEnv() {
    if (!window.confirm('Einstellungen aus der Administration verwerfen und wieder die Werte aus .env verwenden?')) return;
    void run(async () => {
      apply(await api<MailSettingsDto>('/admin/settings/mail', { method: 'DELETE' }));
      return 'Es gelten wieder die Einstellungen aus .env.';
    });
  }

  function changeSecurity(value: SmtpSecurity) {
    // Port mitziehen, solange er noch auf dem Standard der bisherigen Variante steht
    const oldDefault = SECURITY.find((s) => s.value === form.security)?.port;
    const newDefault = SECURITY.find((s) => s.value === value)!.port;
    setForm({ ...form, security: value, port: Number(form.port) === oldDefault ? String(newDefault) : form.port });
  }

  if (!current) return error ? <Alert>{error}</Alert> : <p className="muted">Lade …</p>;

  return (
    <>
      <Card title="Mailversand">
        <p>
          Das Wiki verschickt Einladungen und Links zum Zurücksetzen des Passworts per E-Mail.{' '}
          <span className="badge">{current.source === 'admin' ? 'Administration' : current.source === 'env' ? '.env' : 'nicht eingerichtet'}</span>
        </p>
        <p className="muted">
          {SOURCE_TEXT[current.source]}
          {current.updatedAt && ` Zuletzt geändert: ${formatDate(current.updatedAt)}.`}
        </p>
        <form onSubmit={save}>
          <Field label="SMTP-Server" required placeholder="smtp.example.de" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          <div className="field">
            <label htmlFor={securityId}>Verschlüsselung</label>
            <select id={securityId} value={form.security} onChange={(e) => changeSecurity(e.target.value as SmtpSecurity)}>
              {SECURITY.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <Field label="Port" required type="number" min={1} max={65535} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          <Field
            label="Benutzername"
            autoComplete="off"
            hint="Leer lassen, wenn der Server ohne Anmeldung versendet"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <Field
            label="Passwort"
            type="password"
            autoComplete="new-password"
            placeholder={current.hasPassword ? 'unverändert' : ''}
            hint={current.hasPassword ? 'Leer lassen, um das bisherige Passwort zu behalten' : undefined}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <Field
            label="Absender"
            required
            placeholder="Wiki <wiki@example.de>"
            hint="Muss zum Postfach passen, sonst lehnen viele Mailserver den Versand ab"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
          />
          <div className="row">
            <button type="submit" disabled={busy}>
              Prüfen und speichern
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={(e) => save(e, true)}>
              Ohne Prüfung speichern
            </button>
            {current.source === 'admin' && current.envConfigured && (
              <button type="button" className="secondary" disabled={busy} onClick={resetToEnv}>
                Auf .env zurücksetzen
              </button>
            )}
            {current.source === 'admin' && !current.envConfigured && (
              <button type="button" className="danger" disabled={busy} onClick={resetToEnv}>
                Mailversand abschalten
              </button>
            )}
          </div>
        </form>
      </Card>
      <Card title="Testmail">
        <div className="row">
          <Field label="Empfänger" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button type="button" disabled={busy || current.source === 'none'} onClick={sendTest}>
            Testmail senden
          </button>
        </div>
      </Card>
      {busy && <p className="muted">Verbinde mit dem Mailserver …</p>}
      <Alert>{error}</Alert>
      <Alert kind="success">{success}</Alert>
    </>
  );
}
