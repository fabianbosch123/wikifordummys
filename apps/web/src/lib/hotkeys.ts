'use client';

import { useEffect, useRef } from 'react';

interface HotkeyDef {
  /** Taste wie in KeyboardEvent.key, klein geschrieben */
  key: string;
  /** Mit Strg (unter macOS Cmd) */
  mod?: boolean;
  /** Auch auslösen, wenn der Fokus in einem Eingabefeld oder im Editor liegt */
  inInputs?: boolean;
  /** Anzeige im Tooltip und in der Doku */
  label: string;
  description: string;
  /** Belegt der Editor (TipTap) selbst; steht hier nur für Tooltips und Doku, useHotkeys lässt es aus */
  editor?: boolean;
}

/** Zentrale Liste aller Tastenkürzel; neue hier eintragen und auf der jeweiligen Seite mit useHotkeys belegen */
export const HOTKEYS = {
  editPage: { key: 'e', label: 'E', description: 'Seite bearbeiten' },
  savePage: { key: 's', mod: true, inInputs: true, label: 'Strg+S', description: 'Seite speichern' },
  // Im Editor (Werkzeugleiste); unter macOS Cmd statt Strg
  undo: { key: 'z', mod: true, editor: true, label: 'Strg+Z', description: 'Rückgängig' },
  redo: { key: 'z', mod: true, editor: true, label: 'Strg+Umschalt+Z', description: 'Wiederholen' },
  heading1: { key: '1', mod: true, editor: true, label: 'Strg+Alt+1', description: 'Überschrift 1' },
  heading2: { key: '2', mod: true, editor: true, label: 'Strg+Alt+2', description: 'Überschrift 2' },
  heading3: { key: '3', mod: true, editor: true, label: 'Strg+Alt+3', description: 'Überschrift 3' },
  bold: { key: 'b', mod: true, editor: true, label: 'Strg+B', description: 'Fett' },
  italic: { key: 'i', mod: true, editor: true, label: 'Strg+I', description: 'Kursiv' },
  underline: { key: 'u', mod: true, editor: true, label: 'Strg+U', description: 'Unterstrichen' },
  strike: { key: 's', mod: true, editor: true, label: 'Strg+Umschalt+S', description: 'Durchgestrichen' },
  code: { key: 'e', mod: true, editor: true, label: 'Strg+E', description: 'Code' },
  bulletList: { key: '8', mod: true, editor: true, label: 'Strg+Umschalt+8', description: 'Aufzählung' },
  orderedList: { key: '7', mod: true, editor: true, label: 'Strg+Umschalt+7', description: 'Nummerierte Liste' },
  blockquote: { key: 'b', mod: true, editor: true, label: 'Strg+Umschalt+B', description: 'Zitat' },
  codeBlock: { key: 'c', mod: true, editor: true, label: 'Strg+Alt+C', description: 'Code-Block' },
} satisfies Record<string, HotkeyDef>;

export type HotkeyId = keyof typeof HOTKEYS;
/** Kürzel, die useHotkeys belegt (nicht die des Editors) */
type AppHotkeyId = { [K in HotkeyId]: (typeof HOTKEYS)[K] extends { editor: true } ? never : K }[HotkeyId];

/** Eingabefelder, Auswahllisten und alles Editierbare (TipTap) bekommen ihre Tasten selbst */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
}

function matches(def: HotkeyDef, e: KeyboardEvent): boolean {
  if (e.isComposing || e.key.toLowerCase() !== def.key) return false;
  // Alt bleibt frei (AltGr meldet unter Windows Strg+Alt), Umschalt ebenfalls
  if (e.altKey || e.shiftKey) return false;
  const mod = e.ctrlKey || e.metaKey;
  if (def.mod ? !mod : mod) return false;
  if (!def.inInputs && isEditable(e.target)) return false;
  return true;
}

/**
 * Belegt Tastenkürzel, solange die Komponente angezeigt wird. Ein fehlender Handler (undefined) schaltet das Kürzel
 * ab, etwa wenn der Benutzer die Seite nicht bearbeiten darf.
 */
export function useHotkeys(handlers: Partial<Record<AppHotkeyId, (() => void) | undefined>>) {
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      for (const [id, def] of Object.entries(HOTKEYS) as [HotkeyId, HotkeyDef][]) {
        if (def.editor) continue;
        const handler = current.current[id as AppHotkeyId];
        if (!handler || !matches(def, e)) continue;
        e.preventDefault();
        if (!e.repeat) handler();
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Text für title-Attribute, z. B. „Bearbeiten (E)“ */
export function withHotkey(text: string, id: HotkeyId): string {
  return `${text} (${HOTKEYS[id].label})`;
}
