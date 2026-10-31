'use client';

import type { Editor } from '@tiptap/react';
import { isSafeImageSrc, isSafeLinkHref } from '@wiki/shared';
import { KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

/**
 * Kleine Formulare unter der Werkzeugleiste statt Browser-Popups (prompt/alert): Link setzen, Bild über Adresse
 * einbinden, Beschreibung für ein hochgeladenes Bild. Sie folgen der Darstellung (hell/dunkel), prüfen die Eingabe
 * gleich beim Tippen und schließen mit Escape. Kein eigenes <form>, weil sie im Formular der Seite liegen:
 * Enter würde sonst die Seite speichern.
 */
function InlinePanel({ label, onClose, onEnter, children }: { label: string; onClose: () => void; onEnter: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Nicht auch noch andere Panels der Seite schließen
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      onEnter();
    }
  }

  return (
    <div ref={ref} className="insert-panel" role="group" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/** Kurze Erklärung, wohin ein Link führt */
function describeLink(href: string): string {
  if (href.startsWith('/')) return 'Verweis innerhalb des Wikis';
  if (href.toLowerCase().startsWith('mailto:')) return `E-Mail an ${href.slice(7)}`;
  try {
    return `Externe Seite: ${new URL(href).host}`;
  } catch {
    return '';
  }
}

export function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const id = useId();
  const [previous] = useState(() => editor.getAttributes('link').href as string | undefined);
  const [needsText] = useState(() => editor.state.selection.empty && !previous);
  const [url, setUrl] = useState(previous ?? '');
  const [text, setText] = useState('');
  const href = url.trim();
  const valid = href !== '' && isSafeLinkHref(href);
  const invalid = href !== '' && !valid;

  function close() {
    onClose();
    editor.commands.focus();
  }

  function apply() {
    if (!valid) return;
    const chain = editor.chain().focus();
    if (needsText) {
      chain.insertContent({ type: 'text', text: text.trim() || href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  }

  return (
    <InlinePanel label={previous ? 'Link bearbeiten' : 'Link einfügen'} onClose={close} onEnter={apply}>
      <div className="insert-fields">
        <div className="field">
          <label htmlFor={`${id}-url`}>Adresse des Links</label>
          <input
            id={`${id}-url`}
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="https://… oder /pages/…"
            maxLength={2048}
            value={url}
            aria-invalid={invalid}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setUrl(e.target.value)}
          />
          <small id={`${id}-hint`} className={invalid ? 'insert-hint error' : 'insert-hint muted'} aria-live="polite">
            {invalid
              ? 'Diese Adresse ist nicht erlaubt. Erlaubt sind https://, http://, mailto: und Pfade im Wiki (/…).'
              : valid
                ? describeLink(href)
                : 'Zum Beispiel https://example.de, mailto:name@firma.de oder /pages/…'}
          </small>
        </div>
        {needsText && (
          <div className="field">
            <label htmlFor={`${id}-text`}>Angezeigter Text</label>
            <input id={`${id}-text`} type="text" autoComplete="off" maxLength={500} placeholder={href || 'Wie die Adresse'} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
      </div>
      <p className="row">
        <button type="button" className="small" disabled={!valid} onClick={apply}>
          Übernehmen
        </button>
        {previous && (
          <button type="button" className="small danger" onClick={remove}>
            Link entfernen
          </button>
        )}
        <button type="button" className="small secondary" onClick={close}>
          Abbrechen
        </button>
      </p>
    </InlinePanel>
  );
}

/** Vorschau erst kurz nach dem Tippen laden, nicht bei jedem Buchstaben */
function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Bild über Adresse einbinden, oder (uploaded gesetzt) nur die Beschreibung für ein gerade hochgeladenes Bild abfragen.
 */
export function ImageForm({ editor, uploaded, onClose }: { editor: Editor; uploaded?: { src: string; name: string }; onClose: () => void }) {
  const id = useId();
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [broken, setBroken] = useState(false);
  const src = uploaded ? uploaded.src : url.trim();
  const valid = uploaded ? true : src !== '' && isSafeImageSrc(src);
  const invalid = !uploaded && src !== '' && !valid;
  const previewSrc = useSettled(valid ? src : '', uploaded ? 0 : 500);

  useEffect(() => setBroken(false), [previewSrc]);

  function close() {
    onClose();
    editor.commands.focus();
  }

  function apply() {
    if (!valid) return;
    editor.chain().focus().setImage({ src, alt: alt.trim() }).run();
    onClose();
  }

  return (
    <InlinePanel label={uploaded ? 'Hochgeladenes Bild einfügen' : 'Bild über Adresse einbinden'} onClose={close} onEnter={apply}>
      <div className="insert-fields">
        {uploaded ? (
          <p className="muted insert-hint">„{uploaded.name}“ ist als Anhang gespeichert.</p>
        ) : (
          <div className="field">
            <label htmlFor={`${id}-src`}>Adresse des Bildes</label>
            <input
              id={`${id}-src`}
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="https://…"
              maxLength={2048}
              value={url}
              aria-invalid={invalid}
              aria-describedby={`${id}-hint`}
              onChange={(e) => setUrl(e.target.value)}
            />
            <small id={`${id}-hint`} className={invalid ? 'insert-hint error' : 'insert-hint muted'} aria-live="polite">
              {invalid ? 'Bilder sind nur über https:// erlaubt. Eigene Bilder lassen sich mit „⤒ Bild“ hochladen.' : 'Nur https://-Adressen.'}
            </small>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-alt`}>Kurze Beschreibung (für Screenreader)</label>
          <input id={`${id}-alt`} type="text" autoComplete="off" maxLength={500} value={alt} onChange={(e) => setAlt(e.target.value)} />
        </div>
        {previewSrc && (
          <div className="insert-preview">
            {broken ? (
              <small className="insert-hint error">Unter dieser Adresse lässt sich kein Bild laden.</small>
            ) : (
              <img src={previewSrc} alt="Vorschau" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
            )}
          </div>
        )}
      </div>
      <p className="row">
        <button type="button" className="small" disabled={!valid} onClick={apply}>
          Einfügen
        </button>
        <button type="button" className="small secondary" onClick={close}>
          {uploaded ? 'Nicht einfügen' : 'Abbrechen'}
        </button>
      </p>
      {uploaded && <small className="muted">Auch ohne Einfügen bleibt das Bild unter „Anhänge“ erhalten.</small>}
    </InlinePanel>
  );
}
