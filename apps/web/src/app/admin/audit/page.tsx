'use client';

import type { AuditEntryDto } from '@wiki/shared';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, formatDate } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

const FILTERS = [
  { value: '', label: 'Alle' },
  { value: 'auth.login', label: 'Anmeldungen' },
  { value: 'auth.2fa', label: '2FA' },
  { value: 'auth.password', label: 'Passwörter' },
  { value: 'admin', label: 'Admin-Aktionen' },
];

const PAGE = 100;

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (before?: string) => {
      try {
        const params = new URLSearchParams({ limit: String(PAGE) });
        if (filter) params.set('action', filter);
        if (before) params.set('before', before);
        const page = await api<AuditEntryDto[]>(`/admin/audit?${params}`);
        setEntries((prev) => (before ? [...prev, ...page] : page));
        setMore(page.length === PAGE);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <div className="row">
        <label className="row">
          Filter
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">Einträge werden 365 Tage aufbewahrt.</span>
      </div>
      <Alert>{error}</Alert>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Aktion</th>
              <th>Wer</th>
              <th>IP</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.createdAt)}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>{e.actorEmail ?? <span className="muted">System</span>}</td>
                <td>{e.ip ?? '–'}</td>
                <td>
                  <code>{Object.keys(e.details).length ? JSON.stringify(e.details) : ''}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && (
        <p>
          <button className="secondary" onClick={() => load(entries.at(-1)?.createdAt)}>
            Ältere laden
          </button>
        </p>
      )}
    </Card>
  );
}
