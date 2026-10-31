'use client';

import { sanitizeDoc, type DocNode } from '@wiki/shared';
import { useEffect, useRef } from 'react';

/**
 * Schutz vor dem Verlust ungespeicherter Änderungen beim Seitenwechsel innerhalb der App.
 * Neuladen und Schließen fängt beforeunload ab; App-interne Links (Next-Link) und Wechsel über den Router
 * (Suche, Abmelden) nicht. Darum: Klicks auf Links im Capture-Schritt abfangen, bevor Next sie verarbeitet,
 * und Router-Wechsel in der App vorher über confirmLeave() bestätigen lassen.
 */

/** Für „Abbrechen“ im Editor: verwirft wirklich, auch den Entwurf */
export const DISCARD_QUESTION = 'Ungespeicherte Änderungen verwerfen?';
/** Für Links und Seitenwechsel in der App: der Entwurf bleibt im Tab und wird beim nächsten Bearbeiten angeboten */
export const LEAVE_QUESTION =
  'Seite verlassen? Deine Änderungen sind noch nicht gespeichert. Sie bleiben als Entwurf in diesem Tab erhalten und werden beim nächsten Bearbeiten angeboten.';

let guard: (() => boolean) | null = null;

/** Fragt nach, wenn gerade ungespeicherte Änderungen offen sind; true = weitergehen */
export function confirmLeave(): boolean {
  if (!guard?.()) return true;
  return window.confirm(LEAVE_QUESTION);
}

/** Link, der die aktuelle Seite in diesem Tab verlässt (kein neuer Tab, kein Download, kein Sprung innerhalb der Seite) */
function leavingLink(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const target = e.target instanceof Element ? e.target : null;
  const a = target?.closest('a[href]');
  if (!(a instanceof HTMLAnchorElement)) return null;
  if (a.target && a.target !== '_self') return null;
  if (a.hasAttribute('download')) return null;
  // Links im Editor öffnen sich nicht (openOnClick: false)
  if (a.closest('[contenteditable="true"]')) return null;
  const url = new URL(a.href, window.location.href);
  const here = window.location;
  if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search) return null;
  return a;
}

/**
 * Solange dirty gilt, fragt jeder Klick auf einen Link nach, bevor er die Seite verlässt.
 * Abgelehnt: Klick wird gestoppt, bevor er Next-Link oder den Browser erreicht.
 */
export function useLeaveGuard(dirty: boolean) {
  const current = useRef(dirty);
  current.current = dirty;

  useEffect(() => {
    const check = () => current.current;
    guard = check;
    function onClick(e: MouseEvent) {
      if (!current.current || !leavingLink(e)) return;
      if (window.confirm(LEAVE_QUESTION)) {
        // Bestätigt: nicht ein zweites Mal fragen (z. B. durch beforeunload bei externen Links)
        current.current = false;
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('click', onClick, true);
      if (guard === check) guard = null;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (current.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Nach dem Speichern oder bestätigten Verwerfen: der folgende Seitenwechsel braucht keine Rückfrage */
  return () => {
    current.current = false;
  };
}

// ---------- Entwürfe im Browser ----------

/**
 * Entwürfe liegen im sessionStorage: sie überstehen Neuladen, Seitenwechsel und eine abgelaufene Sitzung im selben Tab,
 * verschwinden aber mit dem Tab. Auf geteilten Rechnern bleibt so kein Seiteninhalt dauerhaft im Browser liegen.
 * Abmelden löscht alle Entwürfe; der Schlüssel enthält die Benutzer-ID, damit niemand den Entwurf eines anderen sieht.
 */
const PREFIX = 'wiki.draft.';
/** Größere Entwürfe werden nicht gespeichert (Speicher des Browsers ist klein) */
const MAX_DRAFT_CHARS = 2_000_000;
/** Ältere Entwürfe gelten als verworfen */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Nach dem Abmelden bis zur nächsten Anmeldung gesperrt: Der Editor sichert beim Aushängen noch einmal,
 * das darf nach clearAllDrafts() nichts mehr zurückschreiben.
 */
let locked = false;

export interface Draft {
  title: string;
  content: DocNode;
  /** Version der Seite, auf der der Entwurf beruht (nur bei bestehenden Seiten) */
  version?: number;
  savedAt: number;
}

export function draftKey(userId: string, scope: string): string {
  return `${PREFIX}${userId}.${scope}`;
}

function isDoc(value: unknown): value is DocNode {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'doc';
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.title !== 'string' || !isDoc(d.content) || typeof d.savedAt !== 'number') return null;
    if (Date.now() - d.savedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    // Dieselbe Inhalts-Whitelist wie für Inhalte von der API (S6); was sie nicht besteht, wird verworfen
    let content: DocNode;
    try {
      content = sanitizeDoc(d.content);
    } catch {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return { title: d.title.slice(0, 500), content, version: typeof d.version === 'number' ? d.version : undefined, savedAt: d.savedAt };
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: Omit<Draft, 'savedAt'>): void {
  if (locked) return;
  try {
    const raw = JSON.stringify({ ...draft, savedAt: Date.now() });
    if (raw.length > MAX_DRAFT_CHARS) return;
    window.sessionStorage.setItem(key, raw);
  } catch {
    // Speicher voll oder gesperrt: dann eben ohne Entwurf
  }
}

export function clearDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // nichts zu tun
  }
}

/** Beim Abmelden: alle Entwürfe dieses Browser-Tabs löschen und bis zur nächsten Anmeldung keine neuen anlegen */
export function clearAllDrafts(): void {
  locked = true;
  removeDrafts(() => true);
}

/** Nach der Anmeldung: Entwürfe wieder erlauben und die anderer Benutzer (z. B. nach abgelaufener Sitzung) löschen */
export function unlockDrafts(userId: string): void {
  locked = false;
  removeDrafts((k) => !k.startsWith(`${PREFIX}${userId}.`));
}

function removeDrafts(match: (key: string) => boolean): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith(PREFIX) && match(k)) keys.push(k);
    }
    for (const k of keys) window.sessionStorage.removeItem(k);
  } catch {
    // nichts zu tun
  }
}
