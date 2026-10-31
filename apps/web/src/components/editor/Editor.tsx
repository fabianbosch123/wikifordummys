'use client';

import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { COLUMN_WIDTH, FONT_FAMILIES, IMAGE_SIZE, isFontFamilyId, isSafeLinkHref, type CalloutVariant, type DocNode, type FeaturesDto, type TreeNodeDto } from '@wiki/shared';
import DOMPurify from 'dompurify';
import type { EditorView } from '@tiptap/pm/view';
import { ChangeEvent, KeyboardEvent, ReactNode, useContext, useRef, useState } from 'react';
import { Alert } from '@/components/ui';
import { errorMessage, uploadAttachment } from '@/lib/api';
import { useApiData } from '@/lib/data';
import { HOTKEYS, withHotkey, type HotkeyId } from '@/lib/hotkeys';
import { flattenTree } from '@/lib/tree';
import { Callout } from './callout';
import { DrawioDialog } from './DrawioDialog';
import { ImageForm, LinkForm } from './InsertForms';
import { Font } from './font';
import { askDrawingTitle, Drawing, DrawingContext } from './drawing';
import { NewOfficeFile } from './NewOfficeFile';
import { pendingFile, placeholderNode, type UploadStore } from './uploads';

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
  // Spaltenbreiten per Ziehen am Spaltenrand; gespeichert als colwidth der Zellen (S6)
  TableKit.configure({ table: { resizable: true, cellMinWidth: COLUMN_WIDTH.min, lastColumnResizable: true } }),
  // Bildgröße per Ziehen an den Anfassern; gespeichert als width/height in Pixeln (S6)
  Image.configure({
    inline: false,
    allowBase64: false,
    resize: {
      enabled: true,
      directions: ['left', 'right', 'bottom-left', 'bottom-right'],
      minWidth: IMAGE_SIZE.min,
      minHeight: IMAGE_SIZE.min,
      alwaysPreserveAspectRatio: true,
    },
  }),
  Callout,
  Drawing,
  Font,
];

function ToolButton({
  label,
  hotkey,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** Tastenkürzel aus hotkeys.ts, erscheint im Tooltip */
  hotkey?: HotkeyId;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool${active ? ' active' : ''}`}
      title={hotkey ? withHotkey(label, hotkey) : label}
      aria-label={label}
      aria-keyshortcuts={hotkey ? HOTKEY_ARIA[hotkey] : undefined}
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

/** aria-keyshortcuts braucht die englischen Tastennamen */
const ariaKeys = (label: string) => label.replace('Strg', 'Control').replace('Umschalt', 'Shift');
const HOTKEY_ARIA = Object.fromEntries(Object.entries(HOTKEYS).map(([id, def]) => [id, ariaKeys(def.label)])) as Record<HotkeyId, string>;

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
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
    editor.commands.focus();
  }
  return (
    <div className="row picker" onKeyDown={onKeyDown}>
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

function Toolbar({ editor, pages, pageId, office }: { editor: Editor; pages: TreeNodeDto[]; pageId?: string; office: boolean }) {
  const [picker, setPicker] = useState(false);
  const [linkForm, setLinkForm] = useState(false);
  const [imageForm, setImageForm] = useState<{ uploaded?: { src: string; name: string } } | null>(null);
  const [notice, setNotice] = useState('');
  const [officePicker, setOfficePicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newDrawing, setNewDrawing] = useState<string | null>(null);
  const drawio = useContext(DrawingContext);
  const imageInput = useRef<HTMLInputElement>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      font: (e.getAttributes('font').family as string | undefined) ?? '',
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

  /** Nur ein Einfügeformular gleichzeitig */
  function openForm(which: 'link' | 'image' | 'page' | null, uploaded?: { src: string; name: string }) {
    setLinkForm(which === 'link');
    setImageForm(which === 'image' ? { uploaded } : null);
    setPicker(which === 'page');
    setNotice('');
  }

  /** Lädt ein Bild als Anhang der Seite hoch und bindet es ein */
  async function uploadImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !pageId) return;
    setUploading(true);
    setNotice('');
    try {
      const attachment = await uploadAttachment(pageId, file);
      if (attachment.preview !== 'image') {
        setNotice('Die Datei wurde als Anhang gespeichert, ist aber kein Bild (PNG, JPEG, GIF oder WebP) und wird nicht eingebunden.');
        return;
      }
      openForm('image', { src: attachment.url, name: attachment.filename });
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  function toggleCallout(variant: CalloutVariant) {
    if (editor.isActive('callout', { variant })) chain().lift('callout').run();
    else if (editor.isActive('callout')) chain().updateAttributes('callout', { variant }).run();
    else chain().wrapIn('callout', { variant }).run();
  }

  return (
    <div className="toolbar-wrap">
      <div className="toolbar" role="toolbar" aria-label="Formatierung">
        <ToolButton label="Rückgängig" hotkey="undo" disabled={!s.canUndo} onClick={() => chain().undo().run()}>
          ↶
        </ToolButton>
        <ToolButton label="Wiederholen" hotkey="redo" disabled={!s.canRedo} onClick={() => chain().redo().run()}>
          ↷
        </ToolButton>
        <span className="sep" />
        <ToolButton label="Überschrift 1" hotkey="heading1" active={s.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
          H1
        </ToolButton>
        <ToolButton label="Überschrift 2" hotkey="heading2" active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolButton>
        <ToolButton label="Überschrift 3" hotkey="heading3" active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolButton>
        <span className="sep" />
        <ToolButton label="Fett" hotkey="bold" active={s.bold} onClick={() => chain().toggleBold().run()}>
          <b>B</b>
        </ToolButton>
        <ToolButton label="Kursiv" hotkey="italic" active={s.italic} onClick={() => chain().toggleItalic().run()}>
          <i>I</i>
        </ToolButton>
        <ToolButton label="Unterstrichen" hotkey="underline" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
          <u>U</u>
        </ToolButton>
        <ToolButton label="Durchgestrichen" hotkey="strike" active={s.strike} onClick={() => chain().toggleStrike().run()}>
          <s>S</s>
        </ToolButton>
        <ToolButton label="Code" hotkey="code" active={s.code} onClick={() => chain().toggleCode().run()}>
          {'</>'}
        </ToolButton>
        <select
          className="tool font-select"
          title="Schriftart"
          aria-label="Schriftart"
          value={s.font}
          onChange={(e) => {
            const family = e.target.value;
            if (isFontFamilyId(family)) chain().setFont(family).run();
            else chain().unsetFont().run();
          }}
        >
          <option value="">Standardschrift</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.id} value={f.id} data-font={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="sep" />
        <ToolButton label="Aufzählung" hotkey="bulletList" active={s.bulletList} onClick={() => chain().toggleBulletList().run()}>
          • Liste
        </ToolButton>
        <ToolButton label="Nummerierte Liste" hotkey="orderedList" active={s.orderedList} onClick={() => chain().toggleOrderedList().run()}>
          1. Liste
        </ToolButton>
        <ToolButton label="Zitat" hotkey="blockquote" active={s.blockquote} onClick={() => chain().toggleBlockquote().run()}>
          ❝
        </ToolButton>
        <ToolButton label="Code-Block" hotkey="codeBlock" active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
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
        <ToolButton label={s.link ? 'Link bearbeiten' : 'Link'} active={s.link || linkForm} onClick={() => openForm(linkForm ? null : 'link')}>
          🔗
        </ToolButton>
        <ToolButton label="Seite verlinken" active={picker} onClick={() => openForm(picker ? null : 'page')} disabled={pages.length === 0}>
          ↪ Seite
        </ToolButton>
        <ToolButton label="Bild über Adresse einbinden" active={imageForm !== null && !imageForm.uploaded} onClick={() => openForm(imageForm ? null : 'image')}>
          🖼
        </ToolButton>
        {pageId && (
          <>
            <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={uploadImage} />
            <ToolButton label="Bild hochladen" disabled={uploading} onClick={() => imageInput.current?.click()}>
              ⤒ Bild
            </ToolButton>
          </>
        )}
        <ToolButton label="Tabelle einfügen" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          ▦
        </ToolButton>
        {drawio.enabled && (
          <ToolButton
            label={pageId ? 'Zeichnung mit draw.io einfügen' : 'Zeichnung einfügen (erst nach dem Anlegen der Seite möglich)'}
            disabled={!pageId}
            onClick={() => setNewDrawing(askDrawingTitle('Zeichnung'))}
          >
            ◇ Zeichnung
          </ToolButton>
        )}
        {office && (
          <ToolButton
            label={pageId ? 'Neue Word-, Excel- oder PowerPoint-Datei anlegen' : 'Neue Office-Datei (erst nach dem Anlegen der Seite möglich)'}
            active={officePicker}
            disabled={!pageId}
            onClick={() => setOfficePicker(!officePicker)}
          >
            ＋ Office-Datei
          </ToolButton>
        )}
      </div>
      {officePicker && pageId && <NewOfficeFile editor={editor} pageId={pageId} onClose={() => setOfficePicker(false)} />}
      {newDrawing !== null && pageId && (
        <DrawioDialog
          pageId={pageId}
          title={newDrawing}
          onSaved={(attrs) => {
            // Erstes Speichern fügt die Zeichnung ein, weiteres Speichern im selben Dialog aktualisiert sie
            let found = false;
            editor.state.doc.descendants((node, pos) => {
              if (found || node.type.name !== 'drawing' || node.attrs.attachmentId !== attrs.attachmentId) return !found;
              found = true;
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
              return false;
            });
            if (!found) chain().insertContent({ type: 'drawing', attrs }).run();
          }}
          onClose={() => setNewDrawing(null)}
        />
      )}
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
      {linkForm && <LinkForm editor={editor} onClose={() => setLinkForm(false)} />}
      {imageForm && <ImageForm key={imageForm.uploaded?.src ?? 'url'} editor={editor} uploaded={imageForm.uploaded} onClose={() => setImageForm(null)} />}
      {notice && (
        <div className="insert-panel">
          <Alert>{notice}</Alert>
        </div>
      )}
    </div>
  );
}

/**
 * WYSIWYG-Editor auf Basis von TipTap. Gespeichert wird das JSON-Dokument; die API prüft es (S6).
 * Eingefügtes HTML wird vorher mit DOMPurify bereinigt.
 * Hineingezogene oder aus der Zwischenablage eingefügte Dateien werden Anhänge der Seite:
 * Bilder erscheinen als Bild, alles andere als Link an der Einfügestelle.
 */
export function WikiEditor({
  initial,
  pages,
  pageId,
  uploads,
  onChange,
}: {
  initial: DocNode;
  pages: TreeNodeDto[];
  /** Bestehende Seite: Dateien werden sofort hochgeladen, sonst erst beim Anlegen der Seite */
  pageId?: string;
  uploads: UploadStore;
  onChange: (doc: DocNode) => void;
}) {
  const self = useRef<Editor | null>(null);
  const features = useApiData<FeaturesDto>('/features');

  function insertFiles(view: EditorView, files: File[], pos: number) {
    const e = self.current;
    if (!e || !view.editable) return;
    const items = files.map(pendingFile);
    for (const p of items) uploads.files.set(p.placeholder, p.file);
    e.chain().focus().insertContentAt(pos, items.map(placeholderNode)).run();
    if (pageId) for (const p of items) void uploads.upload(e, pageId, p);
  }

  const editor = useEditor({
    extensions: editorExtensions,
    content: initial,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'rich editor-content', 'aria-label': 'Seiteninhalt', role: 'textbox', 'aria-multiline': 'true' },
      transformPastedHTML: (html) => DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style'] }),
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (moved || files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        insertFiles(view, files, pos);
        return true;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        // Aus Word & Co. kommt neben dem Text oft ein Bild davon mit; dann gilt der Text
        if (files.length === 0 || event.clipboardData?.types.includes('text/html')) return false;
        insertFiles(view, files, view.state.selection.from);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as DocNode),
  });

  self.current = editor;
  if (!editor) return <p className="muted">Editor wird geladen …</p>;
  return (
    <DrawingContext.Provider value={{ pageId, enabled: features.data?.drawio === true }}>
      <div className="editor">
        <Toolbar editor={editor} pages={pages} pageId={pageId} office={features.data?.office === true} />
        <EditorContent editor={editor} />
      </div>
    </DrawingContext.Provider>
  );
}
