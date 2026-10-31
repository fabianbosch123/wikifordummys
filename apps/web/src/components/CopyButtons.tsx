'use client';

import { useState } from 'react';

/** Kopiert Text in die Zwischenablage; ohne Clipboard-API (z. B. http ohne TLS) über eine unsichtbare Textauswahl */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** Speichert Text als .txt-Datei, ohne Umweg über den Server */
function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Knöpfe „Kopieren“ und optional „Herunterladen“ für Codes und Links, die nur einmal angezeigt werden */
export function CopyButtons({ text, label = 'Kopieren', filename }: { text: string; label?: string; filename?: string }) {
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null);

  async function copy() {
    setStatus((await copyText(text)) ? 'copied' : 'failed');
  }

  return (
    <span className="row copy-buttons">
      <button type="button" className="small secondary" onClick={copy}>
        {label}
      </button>
      {filename && (
        <button type="button" className="small secondary" onClick={() => downloadText(text, filename)}>
          Als Textdatei herunterladen
        </button>
      )}
      <span role="status" className="muted">
        {status === 'copied' ? 'Kopiert.' : status === 'failed' ? 'Kopieren hat nicht geklappt, bitte von Hand markieren.' : ''}
      </span>
    </span>
  );
}
