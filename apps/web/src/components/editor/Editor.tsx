'use client';

import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { isSafeImageSrc, isSafeLinkHref, type CalloutVariant, type DocNode, type TreeNodeDto } from '@wiki/shared';
import DOMPurify from 'dompurify';
import { ReactNode, useState } from 'react';
import { flattenTree } from '@/lib/tree';
import { Callout } from './callout';

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
    link: {
      openOnClick: false,
      autolink: true,
      // Gleiche Regel wie in der API (S6)
      isAllowedUri: (url) => isSafeLinkHref(url),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
    },
  }),
  TableKit.configure({ table: { resizable: false } }),
  Image.configure({ inline: false, allowBase64: false }),
  Callout,
];

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool${active ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Fokus im Editor behalten
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const CALLOUTS: { variant: CalloutVariant; label: string; icon: string }[] = [
  { variant: 'info', label: 'Infobox', icon: 'ℹ' },
  { variant: 'warning', label: 'Warnbox', icon: '⚠' },
  { variant: 'success', label: 'Erfolgsbox', icon: '✓' },
  { variant: 'note', label: 'Notizbox', icon: '✎' },
];

function PageLinkPicker({ editor, pages, onClose }: { editor: Editor; pages: { id: string; label: string }[]; onClose: () => void }) {
  const [pageId, setPageId] = useState(pages[0]?.id ?? '');
  function insert() {
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    const href = `/pages/${target.id}`;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) {
      chain.insertContent({ type: 'text', text: target.label.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  }
  return (
    <div className="row picker">
      <label htmlFor="page-link-target">Seite</label>
      <select id="page-link-target" value={pageId} onChange={(e) => setPageId(e.target.value)}>
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <button type="button" className="small" onClick={insert}>
        Link einfügen
      </button>
      <button type="button" className="small secondary" onClick={onClose}>
        Abbrechen
      </button>
    </div>
  );
}

function Toolbar({ editor, pages }: { editor: Editor; pages: TreeNodeDto[] }) {
  const [picker, setPicker] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      callout: e.isActive('callout'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Adresse des Links (https://… oder /pages/…); leer lassen zum Entfernen', previous ?? 'https://');
    if (url === null) return;
    if (url.trim() === '') {
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!isSafeLinkHref(url.trim())) {
      window.alert('Diese Adresse ist nicht erlaubt. Erlaubt sind https://, http://, mailto: und Pfade im Wiki.');
      return;
    }
    chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  function addImage() {
    const src = window.prompt('Adresse des Bildes (https://…)', 'https://');
    if (!src) return;
    if (!isSafeImageSrc(src.trim())) {
      window.alert('Bilder sind nur über https:// erlaubt. Hochladen folgt mit Meilenstein 3.');
      return;
    }
    const alt = window.prompt('Kurze Beschreibung des Bildes (für Screenreader)') ?? '';
    chain().setImage({ src: src.trim(), alt }).run();
  }

  function toggleCallout(variant: CalloutVariant) {
    if (editor.isActive('callout', { variant })) chain().lift('callout').run();
    else if (editor.isActive('callout')) chain().updateAttributes('callout', { variant }).run();
    else chain().wrapIn('callout', { variant }).run();
  }

  return (
    <div className="toolbar-wrap">
      <div className="toolbar" role="toolbar" aria-label="Formatierung">
        <ToolButton label="Rückgängig" disabled={!s.canUndo} onClick={() => chain().undo().run()}>
          ↶
        </ToolButton>
        <ToolButton label="Wiederholen" disabled={!s.canRedo} onClick={() => chain().redo().run()}>
          ↷
        </ToolButton>
        <span className="sep" />
        <ToolButton label="Überschrift 1" active={s.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
          H1
        </ToolButton>
        <ToolButton label="Überschrift 2" active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolButton>
        <ToolButton label="Überschrift 3" active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolButton>
        <span className="sep" />
        <ToolButton label="Fett" active={s.bold} onClick={() => chain().toggleBold().run()}>
          <b>B</b>
        </ToolButton>
        <ToolButton label="Kursiv" active={s.italic} onClick={() => chain().toggleItalic().run()}>
          <i>I</i>
        </ToolButton>
        <ToolButton label="Durchgestrichen" active={s.strike} onClick={() => chain().toggleStrike().run()}>
          <s>S</s>
        </ToolButton>
        <ToolButton label="Code" active={s.code} onClick={() => chain().toggleCode().run()}>
          {'</>'}
        </ToolButton>
        <span className="sep" />
        <ToolButton label="Aufzählung" active={s.bulletList} onClick={() => chain().toggleBulletList().run()}>
          • Liste
        </ToolButton>
        <ToolButton label="Nummerierte Liste" active={s.orderedList} onClick={() => chain().toggleOrderedList().run()}>
          1. Liste
        </ToolButton>
        <ToolButton label="Zitat" active={s.blockquote} onClick={() => chain().toggleBlockquote().run()}>
          ❝
        </ToolButton>
        <ToolButton label="Code-Block" active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
          {'{ }'}
        </ToolButton>
        <ToolButton label="Trennlinie" onClick={() => chain().setHorizontalRule().run()}>
          ―
        </ToolButton>
        <span className="sep" />
        {CALLOUTS.map((c) => (
          <ToolButton key={c.variant} label={c.label} onClick={() => toggleCallout(c.variant)}>
            {c.icon}
          </ToolButton>
        ))}
        <span className="sep" />
        <ToolButton label="Link" active={s.link} onClick={setLink}>
          🔗
        </ToolButton>
        <ToolButton label="Seite verlinken" onClick={() => setPicker(!picker)} disabled={pages.length === 0}>
          ↪ Seite
        </ToolButton>
        <ToolButton label="Bild" onClick={addImage}>
          🖼
        </ToolButton>
        <ToolButton label="Tabelle einfügen" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          ▦
        </ToolButton>
      </div>
      {s.table && (
        <div className="toolbar" role="toolbar" aria-label="Tabelle">
          <ToolButton label="Zeile darunter einfügen" onClick={() => chain().addRowAfter().run()}>
            + Zeile
          </ToolButton>
          <ToolButton label="Spalte rechts einfügen" onClick={() => chain().addColumnAfter().run()}>
            + Spalte
          </ToolButton>
          <ToolButton label="Zeile löschen" onClick={() => chain().deleteRow().run()}>
            − Zeile
          </ToolButton>
          <ToolButton label="Spalte löschen" onClick={() => chain().deleteColumn().run()}>
            − Spalte
          </ToolButton>
          <ToolButton label="Tabelle löschen" onClick={() => chain().deleteTable().run()}>
            Tabelle löschen
          </ToolButton>
        </div>
      )}
      {picker && <PageLinkPicker editor={editor} pages={flattenTree(pages)} onClose={() => setPicker(false)} />}
    </div>
  );
}

/**
 * WYSIWYG-Editor auf Basis von TipTap. Gespeichert wird das JSON-Dokument; die API prüft es (S6).
 * Eingefügtes HTML wird vorher mit DOMPurify bereinigt.
 */
export function WikiEditor({
  initial,
  pages,
  onChange,
}: {
  initial: DocNode;
  pages: TreeNodeDto[];
  onChange: (doc: DocNode) => void;
}) {
  const editor = useEditor({
    extensions: editorExtensions,
    content: initial,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'rich editor-content', 'aria-label': 'Seiteninhalt', role: 'textbox', 'aria-multiline': 'true' },
      transformPastedHTML: (html) => DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style'] }),
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as DocNode),
  });

  if (!editor) return <p className="muted">Editor wird geladen …</p>;
  return (
    <div className="editor">
      <Toolbar editor={editor} pages={pages} />
      <EditorContent editor={editor} />
    </div>
  );
}
