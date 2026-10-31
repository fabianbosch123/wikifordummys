'use client';

/**
 * Hinweis für die nächste Ansicht nach einem Seitenwechsel innerhalb der App, z. B. „in den Papierkorb verschoben“.
 * Liegt nur im Speicher des Tabs: Neuladen oder ein neuer Tab zeigt ihn nicht noch einmal.
 */
export interface DeletedFlash {
  kind: 'page-deleted';
  pageId: string;
  title: string;
  spaceKey: string;
  /** Seite, auf der der Hinweis erscheinen soll */
  showOn: string;
}

let pending: DeletedFlash | null = null;

export function setFlash(flash: DeletedFlash) {
  pending = flash;
}

/** Holt den Hinweis für diese Seite ab; danach ist er weg */
export function takeFlash(showOn: string): DeletedFlash | null {
  if (!pending || pending.showOn !== showOn) return null;
  const flash = pending;
  pending = null;
  return flash;
}
