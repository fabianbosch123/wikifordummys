'use client';

import type { Editor } from '@tiptap/react';
import type { NewOfficeKind } from '@wiki/shared';
import { SyntheticEvent, useState } from 'react';
import { createOfficeFile, errorMessage } from '@/lib/api';
import { fileParagraph } from './uploads';

export const NEW_OFFICE_FILES: { kind: NewOfficeKind; label: string; name: string }[] = [
  { kind: 'docx', label: 'Word-Dokument', name: 'Neues Dokument' },
  { kind: 'xlsx', label: 'Excel-Tabelle', name: 'Neue Tabelle' },
  { kind: 'pptx', label: 'PowerPoint-Präsentation', name: 'Neue Präsentation' },
];

/** Ziel des Links auf der Seite: die Ansicht im Office-Editor (dort gibt es „Bearbeiten“, wenn erlaubt) */
export const officeHref = (attachmentId: string) => `/attachments/${attachmentId}/office`;

/**
 * Legt ein leeres Word-, Excel- oder PowerPoint-Dokument als Anhang der Seite an, fügt an der Cursorposition
 * einen Link darauf ein und öffnet es in einem neuen Tab im Office-Editor. Die Seite bleibt dabei im Editor offen.
 */
export function NewOfficeFile({ editor, pageId, onClose }: { editor: Editor; pageId: string; onClose: () => void }) {
  const [kind, setKind] = useState<NewOfficeKind>('docx');
  const [name, setName] = useState(NEW_OFFICE_FILES[0].name);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(e: SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || name.trim() === '') return;
    // Tab sofort beim Klick öffnen, sonst blockiert der Browser ihn nach dem Warten auf die API als Pop-up
    const tab = window.open('', '_blank');
    setBusy(true);
    setError('');
    try {
      const a = await createOfficeFile(pageId, kind, name.trim());
      editor.chain().focus().insertContent(fileParagraph(a.filename, officeHref(a.id))).run();
      if (tab) tab.location.href = `${officeHref(a.id)}?mode=edit`;
      else window.alert(`„${a.filename}“ wurde angelegt. Der Browser hat den neuen Tab blockiert; öffnen lässt es sich über die Anhänge der Seite.`);
      onClose();
    } catch (err) {
      tab?.close();
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Kein eigenes <form>: die Zeile liegt im Formular der Seite, Enter darf die Seite nicht speichern
    <div className="row picker" role="group" aria-label="Neue Office-Datei">
      <label htmlFor="new-office-kind">Neu</label>
      <select
        id="new-office-kind"
        value={kind}
        onChange={(e) => {
          const next = e.target.value as NewOfficeKind;
          setKind(next);
          if (!touched) setName(NEW_OFFICE_FILES.find((f) => f.kind === next)!.name);
        }}
      >
        {NEW_OFFICE_FILES.map((f) => (
          <option key={f.kind} value={f.kind}>
            {f.label} (.{f.kind})
          </option>
        ))}
      </select>
      <label htmlFor="new-office-name">Dateiname</label>
      <input
        id="new-office-name"
        value={name}
        maxLength={200}
        onChange={(e) => {
          setName(e.target.value);
          setTouched(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create(e);
          if (e.key === 'Escape') onClose();
        }}
      />
      <button type="button" className="small" disabled={busy || name.trim() === ''} onClick={(e) => void create(e)}>
        {busy ? 'Wird angelegt …' : 'Anlegen und öffnen'}
      </button>
      <button type="button" className="small secondary" onClick={onClose}>
        Abbrechen
      </button>
      {error && (
        <span className="alert error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
