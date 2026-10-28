'use client';

import type { OfficeEditorDto } from '@wiki/shared';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useApiData } from '@/lib/data';

interface DocEditor {
  destroyEditor(): void;
}

declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (elementId: string, config: Record<string, unknown>) => DocEditor };
  }
}

/**
 * Lädt das Skript des Editor-Servers (liegt unter /office/ auf derselben Domain). Das Skript wird aus
 * eigenem Code eingefügt; die CSP erlaubt das über 'strict-dynamic', Inline-Skripte bleiben gesperrt.
 */
function loadScript(src: string): Promise<void> {
  if (window.DocsAPI) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Der Office-Editor ist nicht erreichbar. Läuft der Dienst office (wikictl status)?'));
    document.head.appendChild(script);
  });
}

function OfficeEditor() {
  const { id } = useParams<{ id: string }>();
  const mode = useSearchParams().get('mode') === 'edit' ? 'edit' : 'view';
  const editor = useApiData<OfficeEditorDto>(`/attachments/${id}/office?mode=${mode}`);
  const instance = useRef<DocEditor | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const data = editor.data;
    if (!data) return;
    let cancelled = false;
    loadScript(data.scriptUrl)
      .then(() => {
        if (cancelled || !window.DocsAPI) return;
        instance.current = new window.DocsAPI.DocEditor('office-editor', { ...data.config, width: '100%', height: '100%' });
      })
      .catch((err: unknown) => setError(errorMessage(err)));
    return () => {
      cancelled = true;
      instance.current?.destroyEditor();
      instance.current = null;
    };
  }, [editor.data]);

  const a = editor.data?.attachment;
  return (
    <div className="office">
      <div className="office-bar">
        {a ? (
          <>
            <Link href={`/pages/${a.pageId}`}>← Zurück zur Seite</Link>
            <strong className="office-title">{a.filename}</strong>
            <span className="muted">{mode === 'edit' ? 'Bearbeiten – Speichern legt eine neue Fassung an' : 'Ansicht'}</span>
            {mode === 'view' && a.office === 'edit' && (
              <Link className="button small" href={`/attachments/${a.id}/office?mode=edit`}>
                Bearbeiten
              </Link>
            )}
          </>
        ) : (
          <span className="muted">Office-Editor wird geladen …</span>
        )}
      </div>
      {editor.error && (
        <>
          <Alert>{errorMessage(editor.error)}</Alert>
          {/* z. B. Office-Editor abgeschaltet: die Datei bleibt erreichbar */}
          <p>
            <a className="button small secondary" href={`/api/v1/attachments/${id}?download=1`}>
              Datei herunterladen
            </a>
          </p>
        </>
      )}
      <Alert>{error}</Alert>
      <div className="office-frame">
        <div id="office-editor" data-testid="office-editor" />
      </div>
    </div>
  );
}

export default function OfficePage() {
  return <RequireAuth>{() => <OfficeEditor />}</RequireAuth>;
}
