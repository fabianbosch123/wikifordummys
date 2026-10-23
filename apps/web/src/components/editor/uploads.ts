import type { Editor } from '@tiptap/react';
import type { AttachmentDto, DocNode } from '@wiki/shared';
import { errorMessage, uploadAttachment } from '@/lib/api';

/**
 * Hineingezogene oder eingefügte Dateien erscheinen sofort im Editor, zunächst mit einem Platzhalter:
 * Bilder mit einer blob:-Adresse (Vorschau aus dem Browser), andere Dateien als Link auf „#upload-…“.
 * Nach dem Hochladen als Anhang der Seite zeigt der Platzhalter auf den Anhang; schlägt es fehl, entfällt er.
 * Platzhalter verlassen den Browser nie: die API (S6) würde blob:-Bilder ohnehin ablehnen.
 */

/** Diese Typen bindet der Editor als Bild ein; die API erkennt dieselben als Bild (preview: 'image') */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const FILE_PREFIX = '#upload-';
let counter = 0;

export function isPlaceholder(url: unknown): url is string {
  return typeof url === 'string' && (url.startsWith('blob:') || url.startsWith(FILE_PREFIX));
}

export interface PendingFile {
  placeholder: string;
  file: File;
  image: boolean;
}

export function pendingFile(file: File): PendingFile {
  const image = IMAGE_TYPES.includes(file.type);
  const placeholder = image ? URL.createObjectURL(file) : `${FILE_PREFIX}${Date.now().toString(36)}-${++counter}`;
  return { placeholder, file, image };
}

const stem = (filename: string) => filename.replace(/\.[^.]+$/, '');

/** Anhang als Absatz mit Link, so wie er an der Einfügestelle steht */
export function fileParagraph(filename: string, href: string): DocNode {
  return { type: 'paragraph', content: [{ type: 'text', text: `📎 ${filename}`, marks: [{ type: 'link', attrs: { href } }] }] };
}

export function placeholderNode(p: PendingFile): DocNode {
  return p.image ? { type: 'image', attrs: { src: p.placeholder, alt: stem(p.file.name) } } : fileParagraph(p.file.name, p.placeholder);
}

/** Nur Dateien, deren Platzhalter noch im Dokument steht (nicht wieder gelöscht wurde) */
export function placeholdersIn(doc: DocNode): Set<string> {
  const found = new Set<string>();
  const walk = (n: DocNode) => {
    if (n.type === 'image' && isPlaceholder(n.attrs?.src)) found.add(n.attrs.src as string);
    for (const m of n.marks ?? []) if (m.type === 'link' && isPlaceholder(m.attrs?.href)) found.add(m.attrs.href as string);
    n.content?.forEach(walk);
  };
  walk(doc);
  return found;
}

/**
 * Ersetzt Platzhalter im gespeicherten Dokument durch die hochgeladenen Anhänge.
 * Platzhalter ohne Ergebnis (nicht hochgeladen) entfallen, damit der Inhalt die Prüfung der API besteht.
 */
export function resolveUploads(doc: DocNode, results: Map<string, AttachmentDto>): DocNode {
  const map = (n: DocNode): DocNode[] => {
    if (n.type === 'image' && isPlaceholder(n.attrs?.src)) {
      const a = results.get(n.attrs.src as string);
      if (!a) return [];
      return [a.preview === 'image' ? { ...n, attrs: { ...n.attrs, src: a.url } } : fileParagraph(a.filename, a.url)];
    }
    const link = n.marks?.find((m) => m.type === 'link' && isPlaceholder(m.attrs?.href));
    if (link) {
      const a = results.get(link.attrs!.href as string);
      if (!a) return [];
      return [{ ...n, marks: n.marks!.map((m) => (m === link ? { type: 'link', attrs: { href: a.url } } : m)) }];
    }
    if (!n.content) return [n];
    const content = n.content.flatMap(map);
    // Ein Absatz, der nur aus dem Platzhalter bestand, bleibt als leerer Absatz stehen
    if (content.length) return [{ ...n, content }];
    return [n.type === 'doc' ? { type: 'doc', content: [{ type: 'paragraph' }] } : { type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}) }];
  };
  return map(doc)[0];
}

/**
 * Merkt sich die Dateien des Editors und was daraus geworden ist.
 * Bestehende Seiten laden sofort hoch; neue Seiten erst beim Anlegen (vorher gibt es keine Seite für den Anhang).
 */
export class UploadStore {
  readonly files = new Map<string, File>();
  readonly done = new Map<string, AttachmentDto>();
  private running = 0;

  constructor(private readonly onBusy: (running: number) => void) {}

  get busy() {
    return this.running > 0;
  }

  /** Lädt sofort hoch (bestehende Seite) und tauscht den Platzhalter im Editor aus */
  async upload(editor: Editor, pageId: string, p: PendingFile) {
    this.onBusy(++this.running);
    try {
      const attachment = await uploadAttachment(pageId, p.file);
      this.done.set(p.placeholder, attachment);
      settleInEditor(editor, p.placeholder, attachment);
    } catch (err) {
      settleInEditor(editor, p.placeholder, null);
      window.alert(`„${p.file.name}“ wurde nicht eingefügt: ${errorMessage(err)}`);
    } finally {
      this.onBusy(--this.running);
    }
  }

  /** Dateien, deren Platzhalter noch im Dokument steht und die noch nicht hochgeladen sind */
  pendingIn(doc: DocNode): Map<string, File> {
    const result = new Map<string, File>();
    for (const p of placeholdersIn(doc)) {
      const file = this.files.get(p);
      if (file && !this.done.has(p)) result.set(p, file);
    }
    return result;
  }
}

/** Neue Seite: nach dem Anlegen die gemerkten Dateien hochladen und den Inhalt mit den Anhängen liefern */
export async function uploadPending(pageId: string, doc: DocNode, files: Map<string, File>): Promise<{ content: DocNode; failed: string[] }> {
  const results = new Map<string, AttachmentDto>();
  const failed: string[] = [];
  for (const [placeholder, file] of files) {
    try {
      results.set(placeholder, await uploadAttachment(pageId, file));
    } catch (err) {
      failed.push(`„${file.name}“: ${errorMessage(err)}`);
    }
  }
  return { content: resolveUploads(doc, results), failed };
}

/** Dasselbe wie resolveUploads, aber im laufenden Editor, ohne Cursor und Verlauf zu verlieren */
export function settleInEditor(editor: Editor, placeholder: string, attachment: AttachmentDto | null) {
  const { state } = editor;
  const linkType = state.schema.marks.link;
  const hits: { pos: number; size: number; image: boolean; attrs: Record<string, unknown> }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.src === placeholder) hits.push({ pos, size: node.nodeSize, image: true, attrs: node.attrs });
    else if (node.isText && node.marks.some((m) => m.type === linkType && m.attrs.href === placeholder))
      hits.push({ pos, size: node.nodeSize, image: false, attrs: {} });
  });
  if (hits.length === 0) return;
  const tr = state.tr;
  // Von hinten nach vorn, damit die Positionen davor gültig bleiben
  for (const h of hits.reverse()) {
    const to = h.pos + h.size;
    if (!attachment) tr.delete(h.pos, to);
    else if (!h.image) tr.removeMark(h.pos, to, linkType).addMark(h.pos, to, linkType.create({ href: attachment.url }));
    else if (attachment.preview === 'image') tr.setNodeMarkup(h.pos, undefined, { ...h.attrs, src: attachment.url });
    else tr.replaceWith(h.pos, to, state.schema.nodeFromJSON(fileParagraph(attachment.filename, attachment.url)));
  }
  editor.view.dispatch(tr.setMeta('addToHistory', false));
}
