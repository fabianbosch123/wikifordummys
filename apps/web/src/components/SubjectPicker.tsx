'use client';

import type { DirectoryDto, SubjectDto } from '@wiki/shared';
import { ReactNode, useId, useState } from 'react';

/** Auswahl einer Gruppe oder Person aus dem Verzeichnis; bereits gewählte werden ausgeblendet */
export function SubjectPicker({
  directory,
  exclude,
  onAdd,
  children,
}: {
  directory: DirectoryDto;
  exclude: SubjectDto[];
  /** false: abgebrochen (z. B. Rückfrage verneint), die Auswahl bleibt stehen */
  onAdd: (subject: SubjectDto) => boolean | void;
  /** Weitere Eingaben vor dem Button, z. B. die Rolle */
  children?: ReactNode;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  const taken = new Set(exclude.map((s) => `${s.type}:${s.id}`));
  const groups = directory.groups.filter((g) => !taken.has(`group:${g.id}`));
  const users = directory.users.filter((u) => !taken.has(`user:${u.id}`));

  function add() {
    const [type, subjectId] = value.split(':') as ['group' | 'user', string];
    const name = type === 'group' ? groups.find((g) => g.id === subjectId)?.name : users.find((u) => u.id === subjectId)?.displayName;
    if (!name) return;
    if (onAdd({ type, id: subjectId, name }) === false) return;
    setValue('');
  }

  return (
    <div className="row">
      <label htmlFor={id} className="visually-hidden">
        Gruppe oder Person
      </label>
      <select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Gruppe oder Person wählen …</option>
        {groups.length > 0 && (
          <optgroup label="Gruppen">
            {groups.map((g) => (
              <option key={g.id} value={`group:${g.id}`}>
                {g.name}
              </option>
            ))}
          </optgroup>
        )}
        {users.length > 0 && (
          <optgroup label="Personen">
            {users.map((u) => (
              <option key={u.id} value={`user:${u.id}`}>
                {u.displayName}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {children}
      <button type="button" className="small secondary" disabled={!value} onClick={add}>
        Hinzufügen
      </button>
    </div>
  );
}

export function subjectLabel(s: SubjectDto) {
  return s.type === 'group' ? `Gruppe ${s.name}` : s.name;
}
