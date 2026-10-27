'use client';

import type { AttachmentDto } from '@wiki/shared';
import { drawingSrc } from '@wiki/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage, uploadAttachment, uploadAttachmentVersion } from '@/lib/api';
import {
  blobToDataUrl,
  dataUrlToBlob,
  displaySize,
  DRAWIO_CONFIG,
  DRAWIO_SANDBOX,
  DRAWIO_URL,
  drawingFilename,
  drawingText,
  EXPORT_SCALE,
  parseMessage,
} from './drawio';

/** Was eine Zeichnung im Seiteninhalt ausmacht (Attribute des Knotens drawing) */
export interface DrawingAttrs {
  attachmentId: string;
  version: number;
  title: string;
  width: number;
  height: number;
  text: string;
}

/**
 * draw.io im Vollbild über der Seite. Speichern legt die Zeichnung als PNG mit eingebetteten draw.io-Daten ab:
 * neue Zeichnungen als Anhang der Seite, bearbeitete als neue Fassung ihres Anhangs. Die Seite selbst wird
 * erst mit „Speichern“ im Seiteneditor gespeichert und verweist dann auf genau diese Fassung.
 */
export function DrawioDialog({
  pageId,
  drawing,
  title,
  onSaved,
  onClose,
}: {
  pageId: string;
  /** Vorhandene Zeichnung zum Bearbeiten; ohne beginnt eine leere */
  drawing?: Pick<DrawingAttrs, 'attachmentId' | 'version'>;
  title: string;
  onSaved: (attrs: DrawingAttrs) => void;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState('draw.io wird geladen …');
  const [failed, setFailed] = useState(false);
  // Aktuelle Werte für den Nachrichten-Handler, ohne ihn bei jeder Änderung neu anzumelden
  const latest = useRef({ pageId, drawing, title, onSaved, onClose });
  latest.current = { pageId, drawing, title, onSaved, onClose };

  useEffect(() => {
    let saving: { exit: boolean; text: string } | null = null;
    let attachmentId = latest.current.drawing?.attachmentId;
    // Ohne Antwort ist der Dienst drawio nicht erreichbar (abgeschaltet oder gestört)
    const timeout = window.setTimeout(() => {
      setStatus('draw.io antwortet nicht. Läuft der Dienst drawio (wikictl status)?');
      setFailed(true);
    }, 30_000);
    // Der Rahmen hat wegen sandbox den Ursprung "null", ein Ziel-Ursprung lässt sich deshalb nicht angeben. Gesendet wird
    // erst, wenn sich draw.io im Rahmen gemeldet hat, und nicht mehr, sobald der Rahmen eine andere Seite lädt (SEC-019).
    let drawio: Window | null = null;
    let loads = 0;
    const onFrameLoad = () => {
      if (++loads < 2) return;
      drawio = null;
      setStatus('draw.io wurde neu geladen. Bitte schließen und die Zeichnung erneut öffnen.');
      setFailed(true);
    };
    const frameEl = frame.current;
    frameEl?.addEventListener('load', onFrameLoad);
    const post = (msg: object) => {
      const target = frame.current?.contentWindow;
      if (target && target === drawio) target.postMessage(JSON.stringify(msg), '*');
    };

    async function load() {
      const { drawing: d, title: t } = latest.current;
      const src = d ? drawingSrc(d) : null;
      if (!src) {
        post({ action: 'load', xml: '', autosave: 0, title: t });
        setStatus('');
        return;
      }
      try {
        const res = await fetch(src, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Die Zeichnung ließ sich nicht laden (HTTP ${res.status}).`);
        post({ action: 'load', xmlpng: await blobToDataUrl(await res.blob()), autosave: 0, title: t });
        setStatus('');
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
        latest.current.onClose();
      }
    }

    /** Vorhandener Anhang derselben Seite bekommt eine neue Fassung; sonst (neu, kopiert von anderer Seite) ein neuer Anhang */
    async function store(png: Blob): Promise<AttachmentDto> {
      const { pageId: p, title: t } = latest.current;
      if (attachmentId) {
        const own = await api<AttachmentDto[]>(`/pages/${p}/attachments`);
        if (own.some((a) => a.id === attachmentId)) return uploadAttachmentVersion(attachmentId, png);
      }
      return uploadAttachment(p, new File([png], drawingFilename(t), { type: 'image/png' }));
    }

    async function save(dataUrl: string | undefined) {
      const job = saving;
      if (!job || !dataUrl) return;
      setStatus('Zeichnung wird gespeichert …');
      try {
        const png = dataUrlToBlob(dataUrl);
        const [attachment, size] = await Promise.all([store(png), displaySize(png)]);
        attachmentId = attachment.id;
        latest.current.onSaved({ attachmentId: attachment.id, version: attachment.version, title: latest.current.title, text: job.text, ...size });
        setStatus('Gespeichert. Die Seite selbst mit „Speichern“ im Editor speichern.');
        post({ action: 'status', message: 'Gespeichert', modified: false });
        if (job.exit) latest.current.onClose();
      } catch (err) {
        setStatus('');
        post({ action: 'status', message: 'Nicht gespeichert', modified: true });
        window.alert(`Die Zeichnung wurde nicht gespeichert: ${errorMessage(err)}`);
      } finally {
        saving = null;
      }
    }

    function onMessage(e: MessageEvent) {
      // Der Rahmen hat wegen sandbox keinen eigenen Ursprung ("null"); maßgeblich ist, dass die Nachricht aus ihm kommt
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const msg = parseMessage(e.data);
      if (!msg) return;
      if (msg.event === 'configure' || msg.event === 'init') drawio = e.source as Window;
      switch (msg.event) {
        case 'configure':
          window.clearTimeout(timeout);
          post({ action: 'configure', config: DRAWIO_CONFIG });
          break;
        case 'init':
          window.clearTimeout(timeout);
          void load();
          break;
        case 'save':
          if (saving) return;
          saving = { exit: msg.exit === true, text: drawingText(msg.xml) };
          post({ action: 'export', format: 'xmlpng', scale: EXPORT_SCALE, border: 10, background: '#ffffff', spinKey: 'saving' });
          break;
        case 'export':
          void save(msg.data);
          break;
        case 'exit':
          latest.current.onClose();
          break;
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frameEl?.removeEventListener('load', onFrameLoad);
    };
  }, []);

  // Seite im Hintergrund nicht mitscrollen lassen
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div className="drawio-overlay" role="dialog" aria-modal="true" aria-label={`Zeichnung „${title}“ bearbeiten`}>
      {status && (
        <p className="drawio-status" role="status">
          {status}
          {failed && (
            <button type="button" className="small secondary" onClick={onClose}>
              Schließen
            </button>
          )}
        </p>
      )}
      <iframe ref={frame} className="drawio-frame" title="draw.io" src={DRAWIO_URL} sandbox={DRAWIO_SANDBOX} data-testid="drawio-frame" />
    </div>,
    document.body,
  );
}
