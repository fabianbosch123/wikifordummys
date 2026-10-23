'use client';

import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { DRAWING_LIMITS, drawingSrc } from '@wiki/shared';
import { createContext, useContext, useState } from 'react';
import { DrawioDialog } from './DrawioDialog';

/** Was der Seiteneditor den Zeichnungen mitgibt: Seite für die Anhänge und ob draw.io eingerichtet ist */
export const DrawingContext = createContext<{ pageId?: string; enabled: boolean }>({ enabled: false });

export function askDrawingTitle(current: string): string | null {
  const title = window.prompt('Titel der Zeichnung (z. B. „Netzwerk Büro“; auch für Screenreader)', current);
  return title === null ? null : title.trim().slice(0, DRAWING_LIMITS.maxTitle) || 'Zeichnung';
}

function DrawingView({ node, editor, selected, updateAttributes }: ReactNodeViewProps) {
  const { pageId, enabled } = useContext(DrawingContext);
  const [editing, setEditing] = useState(false);
  const src = drawingSrc(node.attrs);
  const title = typeof node.attrs.title === 'string' && node.attrs.title ? node.attrs.title : 'Zeichnung';
  const canEdit = editor.isEditable && enabled && !!pageId;

  return (
    <NodeViewWrapper className={`drawing${selected ? ' selected' : ''}`} data-drag-handle="" onDoubleClick={() => canEdit && setEditing(true)}>
      {src ? (
        <img src={src} alt={title} width={node.attrs.width ?? undefined} height={node.attrs.height ?? undefined} draggable={false} />
      ) : (
        <p className="muted">Zeichnung fehlt</p>
      )}
      {editor.isEditable && (
        <span className="drawing-actions">
          <button
            type="button"
            className="small"
            disabled={!canEdit}
            title={canEdit ? 'In draw.io bearbeiten (auch per Doppelklick)' : 'draw.io ist auf diesem Server nicht eingerichtet (wikictl drawio on)'}
            onClick={() => setEditing(true)}
          >
            ✎ Zeichnung bearbeiten
          </button>
          <button
            type="button"
            className="small secondary"
            onClick={() => {
              const next = askDrawingTitle(title);
              if (next !== null) updateAttributes({ title: next });
            }}
          >
            Titel …
          </button>
        </span>
      )}
      {editing && pageId && (
        <DrawioDialog
          pageId={pageId}
          title={title}
          drawing={{ attachmentId: node.attrs.attachmentId, version: node.attrs.version }}
          onSaved={(attrs) => updateAttributes(attrs)}
          onClose={() => setEditing(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

/** Attribut als data-…-Attribut im HTML, damit Kopieren und Einfügen im Editor die Zeichnung behält */
const dataAttr = (key: string, parse: (v: string) => unknown = (v) => v) => {
  const name = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(name);
      return v === null ? null : parse(v);
    },
    renderHTML: (attrs: Record<string, unknown>) => (attrs[key] === null || attrs[key] === undefined ? {} : { [name]: String(attrs[key]) }),
  };
};
const toInt = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);

/**
 * Zeichnung aus draw.io: ein Block, der auf eine feste Fassung eines PNG-Anhangs verweist (mit eingebetteten
 * draw.io-Daten zum Weiterbearbeiten). Die API prüft die Attribute (S6); text sind die Beschriftungen für die Suche.
 */
export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: dataAttr('attachmentId'),
      version: dataAttr('version', toInt),
      title: dataAttr('title'),
      width: dataAttr('width', toInt),
      height: dataAttr('height', toInt),
      text: dataAttr('text'),
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-drawing]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = drawingSrc(node.attrs);
    return ['figure', mergeAttributes({ 'data-drawing': '' }, HTMLAttributes), ['img', { src: src ?? '', alt: node.attrs.title ?? 'Zeichnung' }]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingView);
  },
});
