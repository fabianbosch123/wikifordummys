'use client';

import type { DirectoryDto, PageDto, PageRestrictionsDto, RestrictionType, SubjectDto } from '@wiki/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SubjectPicker, subjectLabel } from '@/components/SubjectPicker';
import { Alert, DialogPanel } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApiData } from '@/lib/data';

const LABELS: Record<RestrictionType, { title: string; hint: string }> = {
  view: { title: 'Ansehen', hint: 'Nur diese Gruppen und Personen sehen die Seite und ihre Unterseiten.' },
  edit: { title: 'Bearbeiten', hint: 'Nur diese Gruppen und Personen dürfen die Seite und ihre Unterseiten ändern.' },
};

function SubjectList({
  type,
  subjects,
  directory,
  onChange,
}: {
  type: RestrictionType;
  subjects: SubjectDto[];
  directory: DirectoryDto;
  onChange: (next: SubjectDto[]) => void;
}) {
  return (
    <fieldset className="field">
      <legend>
        <strong>{LABELS[type].title}</strong>
      </legend>
      <small className="muted">{subjects.length === 0 ? 'Keine Einschränkung: es gelten die Rollen des Spaces.' : LABELS[type].hint}</small>
      {subjects.length > 0 && (
        <ul className="subject-list">
          {subjects.map((s) => (
            <li key={`${s.type}:${s.id}`}>
              {subjectLabel(s)}
              <button
                type="button"
                className="link"
                aria-label={`${subjectLabel(s)} entfernen`}
                onClick={() => onChange(subjects.filter((x) => x !== s))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <SubjectPicker directory={directory} exclude={subjects} onAdd={(s) => onChange([...subjects, s])} />
    </fieldset>
  );
}

/** Einschränkungen „Ansehen“ und „Bearbeiten“ einer Seite; sie gelten auch für alle Unterseiten */
export function RestrictionsDialog({ page, onDone, onCancel }: { page: PageDto; onDone: () => void; onCancel: () => void }) {
  const current = useApiData<PageRestrictionsDto>(`/pages/${page.id}/restrictions`);
  const directory = useApiData<DirectoryDto>('/directory');
  const [view, setView] = useState<SubjectDto[]>([]);
  const [edit, setEdit] = useState<SubjectDto[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  // Hinzugefügte Einträge gelten erst nach dem Speichern: beim Verlassen der Seite warnen (N-3)
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const changeView = (next: SubjectDto[]) => {
    setView(next);
    setDirty(true);
  };
  const changeEdit = (next: SubjectDto[]) => {
    setEdit(next);
    setDirty(true);
  };

  function cancel() {
    if (dirty && !window.confirm('Die Änderungen an den Einschränkungen sind noch nicht gespeichert. Verwerfen?')) return;
    onCancel();
  }

  useEffect(() => {
    if (!current.data) return;
    setView(current.data.view);
    setEdit(current.data.edit);
  }, [current.data]);

  async function save() {
    setError('');
    const refs = (list: SubjectDto[]) => list.map(({ type, id }) => ({ type, id }));
    try {
      await api(`/pages/${page.id}/restrictions`, { method: 'PUT', body: { view: refs(view), edit: refs(edit) } });
      setDirty(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const loaded = !!current.data && !!directory.data;
  return (
    <DialogPanel title="Einschränkungen" ready={loaded} onClose={cancel}>
      {current.error ? (
        <Alert>{errorMessage(current.error)}</Alert>
      ) : !current.data || !directory.data ? (
        <p className="muted">Lade Einschränkungen …</p>
      ) : (
        <>
          {current.data.inherited.length > 0 && (
            <Alert kind="info">
              Zusätzlich gelten Einschränkungen von übergeordneten Seiten:{' '}
              {current.data.inherited.map((i, n) => (
                <span key={`${i.pageId}:${i.type}`}>
                  {n > 0 && ', '}
                  <Link href={`/pages/${i.pageId}`}>{i.title}</Link> ({LABELS[i.type].title})
                </span>
              ))}
            </Alert>
          )}
          <SubjectList type="view" subjects={view} directory={directory.data} onChange={changeView} />
          <SubjectList type="edit" subjects={edit} directory={directory.data} onChange={changeEdit} />
          <Alert>{error}</Alert>
          <p className="row">
            <button className="small" onClick={save}>
              Einschränkungen speichern
            </button>
            <button className="small secondary" onClick={cancel}>
              Abbrechen
            </button>
            {dirty && (
              <span className="unsaved" role="status">
                Noch nicht gespeichert: Die Änderungen gelten erst nach „Einschränkungen speichern“.
              </span>
            )}
          </p>
        </>
      )}
    </DialogPanel>
  );
}
