'use client';

import { useEffect, useState } from 'react';

/**
 * Kurze Erfolgsmeldung, die einen Seitenwechsel übersteht (z. B. „Passwort geändert“ und dann weiter zur Startseite).
 * Liegt nur im sessionStorage dieses Tabs und wird beim ersten Anzeigen gelöscht. Nur eigene, feste Texte ablegen.
 */
const KEY = 'wiki_flash';

export function setFlash(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // ohne sessionStorage (privates Fenster, gesperrt) entfällt die Meldung
  }
}

/** Holt die Meldung einmal ab; danach ist sie weg */
export function useFlash(): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    try {
      const value = sessionStorage.getItem(KEY);
      if (value) {
        sessionStorage.removeItem(KEY);
        setText(value);
      }
    } catch {
      // siehe setFlash
    }
  }, []);
  return text;
}
