'use client';

import { InputHTMLAttributes, ReactNode, useEffect, useId, useRef } from 'react';

export function Field({ label, hint, ...props }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && (
        <small id={`${id}-hint`} className="muted">
          {hint}
        </small>
      )}
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return (
    <p className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

const FIELDS = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE = `${FIELDS}, button:not([disabled]), a[href]`;

/**
 * Aufklappbares Formular auf der Seite (kein modaler Dialog): als Dialog gekennzeichnet, beim Öffnen springt der
 * Fokus ins erste Feld, Escape schließt, danach steht der Fokus wieder auf dem Knopf, der es geöffnet hat.
 * ready: erst fokussieren, wenn die Felder da sind (z. B. nach dem Laden).
 */
export function DialogPanel({ title, ready = true, onClose, children }: { title: string; ready?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const headingId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      close.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      // Fokus zurück, sofern er beim Schließen nicht schon woanders hingesprungen ist
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body || ref.current?.contains(active))) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const first = ref.current?.querySelector<HTMLElement>(FIELDS) ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
  }, [ready]);

  return (
    <section ref={ref} className="card dialog-panel" role="dialog" aria-labelledby={headingId} tabIndex={-1}>
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  );
}
