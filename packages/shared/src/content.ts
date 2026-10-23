/**
 * Seiteninhalt als TipTap-JSON (S6): nur die hier aufgeführten Knoten, Marks und Attribute sind erlaubt.
 * Die API prüft und bereinigt jeden gespeicherten Inhalt damit; die Weboberfläche rendert nur diese Knoten.
 */

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

export const CALLOUT_VARIANTS = ['info', 'warning', 'success', 'note'] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export const CONTENT_LIMITS = {
  maxDepth: 40,
  maxNodes: 50_000,
  maxTextLength: 200_000,
  maxUrlLength: 2_000,
} as const;

/** Grenzen für die im Editor gezogene Bildgröße (Breite und Höhe in Pixeln) */
export const IMAGE_SIZE = { min: 16, max: 5_000 } as const;

/** Grenzen für die im Editor gezogene Spaltenbreite von Tabellen (Pixel) */
export const COLUMN_WIDTH = { min: 40, max: 5_000 } as const;

export class ContentError extends Error {}

type AttrSanitizer = (attrs: Record<string, unknown>) => Record<string, unknown> | undefined;

const intIn = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;

/** Bildgröße in Pixeln; der Editor liefert beim Ziehen auch Kommazahlen, gespeichert wird gerundet */
const sizePx = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? intIn(Math.round(value), IMAGE_SIZE.min, IMAGE_SIZE.max) : undefined;

const str = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined;

/** Leere Attribut-Objekte weglassen, damit der gespeicherte Inhalt stabil bleibt */
function compact(attrs: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * Erlaubte Link-Ziele: http(s), mailto, relative Pfade im Wiki und Anker.
 * Steuerzeichen und Leerraum sind verboten, damit Varianten wie „java\tscript:“ nicht durchrutschen.
 */
export function isSafeLinkHref(href: unknown): href is string {
  if (typeof href !== 'string' || href.length === 0 || href.length > CONTENT_LIMITS.maxUrlLength) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f\\]/.test(href)) return false;
  if (href.startsWith('#')) return true;
  if (href.startsWith('/')) return !href.startsWith('//');
  return /^(https?:\/\/[^/]|mailto:)/i.test(href);
}

/** Bilder nur über https oder als Pfad im Wiki (z. B. hochgeladene Anhänge unter /api/v1/attachments/…) */
export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== 'string' || src.length === 0 || src.length > CONTENT_LIMITS.maxUrlLength) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f\\]/.test(src)) return false;
  if (src.startsWith('/')) return !src.startsWith('//');
  return /^https:\/\/[^/]/i.test(src);
}

/**
 * Spaltenbreiten einer Zelle (je überspannter Spalte ein Wert in Pixeln, 0 = automatisch),
 * so wie sie das Ziehen am Spaltenrand im Editor setzt. Ungültige Angaben entfallen ganz.
 */
const colwidths = (value: unknown, colspan: number): number[] | undefined => {
  if (!Array.isArray(value) || value.length !== colspan) return undefined;
  const widths = value.map((w) => (typeof w === 'number' && Number.isFinite(w) ? intIn(Math.round(w), 0, COLUMN_WIDTH.max) : undefined));
  if (widths.some((w) => w === undefined) || widths.every((w) => w === 0)) return undefined;
  return widths.map((w) => (w && w < COLUMN_WIDTH.min ? COLUMN_WIDTH.min : (w as number)));
};

const cellAttrs: AttrSanitizer = (a) => {
  const colspan = intIn(a.colspan, 1, 50) ?? 1;
  return compact({
    colspan,
    rowspan: intIn(a.rowspan, 1, 50) ?? 1,
    colwidth: colwidths(a.colwidth, colspan),
  });
};

/** Erlaubte Knoten und wie ihre Attribute bereinigt werden. Unbekannte Attribute entfallen. */
const NODES: Record<string, AttrSanitizer | null> = {
  doc: null,
  paragraph: null,
  text: null,
  hardBreak: null,
  horizontalRule: null,
  blockquote: null,
  bulletList: null,
  listItem: null,
  heading: (a) => {
    const level = intIn(a.level, 1, 4);
    if (level === undefined) throw new ContentError('Überschriften sind nur in den Ebenen 1 bis 4 erlaubt.');
    return { level };
  },
  orderedList: (a) => compact({ start: intIn(a.start, 0, 1_000_000) ?? 1 }),
  codeBlock: (a) => {
    const language = str(a.language, 30);
    return compact({ language: language && /^[a-z0-9+#.-]+$/i.test(language) ? language.toLowerCase() : undefined });
  },
  table: null,
  tableRow: null,
  tableHeader: cellAttrs,
  tableCell: cellAttrs,
  image: (a) => {
    if (!isSafeImageSrc(a.src)) throw new ContentError('Bilder sind nur über https:// oder als Pfad im Wiki erlaubt.');
    return compact({ src: a.src, alt: str(a.alt, 500), title: str(a.title, 500), width: sizePx(a.width), height: sizePx(a.height) });
  },
  callout: (a) => {
    const variant = CALLOUT_VARIANTS.includes(a.variant as CalloutVariant) ? (a.variant as CalloutVariant) : 'info';
    return { variant };
  },
};

const MARKS: Record<string, AttrSanitizer | null> = {
  bold: null,
  italic: null,
  strike: null,
  underline: null,
  code: null,
  link: (a) => {
    if (!isSafeLinkHref(a.href)) throw new ContentError('Unzulässiges Link-Ziel.');
    return { href: a.href };
  },
};

export const ALLOWED_NODE_TYPES = Object.keys(NODES);
export const ALLOWED_MARK_TYPES = Object.keys(MARKS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Prüft und bereinigt ein TipTap-Dokument. Wirft ContentError bei unbekannten Knoten, Marks,
 * unsicheren URLs oder zu großen Dokumenten. Unbekannte Attribute werden entfernt.
 */
export function sanitizeDoc(input: unknown): DocNode {
  let nodes = 0;
  let textLength = 0;

  const visit = (raw: unknown, depth: number): DocNode => {
    if (depth > CONTENT_LIMITS.maxDepth) throw new ContentError('Das Dokument ist zu tief verschachtelt.');
    if (++nodes > CONTENT_LIMITS.maxNodes) throw new ContentError('Das Dokument ist zu groß.');
    if (!isRecord(raw) || typeof raw.type !== 'string') throw new ContentError('Ungültiger Knoten.');
    const type = raw.type;
    if (!Object.hasOwn(NODES, type)) throw new ContentError(`Nicht erlaubter Inhalt: ${type.slice(0, 40)}`);
    if (type === 'doc' && depth > 0) throw new ContentError('Ungültiger Knoten.');

    const node: DocNode = { type };
    const sanitizeAttrs = NODES[type];
    if (sanitizeAttrs) {
      const attrs = sanitizeAttrs(isRecord(raw.attrs) ? raw.attrs : {});
      if (attrs) node.attrs = attrs;
    }

    if (type === 'text') {
      if (typeof raw.text !== 'string' || raw.text.length === 0) throw new ContentError('Leerer Textknoten.');
      textLength += raw.text.length;
      if (textLength > CONTENT_LIMITS.maxTextLength) throw new ContentError('Das Dokument ist zu groß.');
      node.text = raw.text;
      if (raw.marks !== undefined) {
        if (!Array.isArray(raw.marks) || raw.marks.length > 10) throw new ContentError('Ungültige Formatierung.');
        const marks = raw.marks.map((m): DocMark => {
          if (!isRecord(m) || typeof m.type !== 'string' || !Object.hasOwn(MARKS, m.type)) {
            throw new ContentError('Nicht erlaubte Formatierung.');
          }
          const sanitizeMark = MARKS[m.type];
          const attrs = sanitizeMark ? sanitizeMark(isRecord(m.attrs) ? m.attrs : {}) : undefined;
          return attrs ? { type: m.type, attrs } : { type: m.type };
        });
        if (marks.length) node.marks = marks;
      }
      return node;
    }

    if (raw.content !== undefined) {
      if (!Array.isArray(raw.content)) throw new ContentError('Ungültiger Knoten.');
      if (raw.content.length) node.content = raw.content.map((c) => visit(c, depth + 1));
    }
    return node;
  };

  if (!isRecord(input) || input.type !== 'doc') throw new ContentError('Der Inhalt muss ein Dokument sein.');
  const doc = visit(input, 0);
  if (!doc.content) doc.content = [{ type: 'paragraph' }];
  return doc;
}

export interface TableLayout {
  /** Breite je Spalte in Pixeln, null = automatisch */
  columns: (number | null)[];
  /** Feste Tabellenbreite, wenn alle Spalten eine Breite haben */
  width?: number;
  /** Sonst Mindestbreite der Tabelle (automatische Spalten mit Mindestbreite gerechnet) */
  minWidth?: number;
}

/**
 * Spaltenbreiten einer Tabelle aus der ersten Zeile, wie sie der Editor beim Ziehen speichert.
 * Rechnet wie TipTap, damit die Ansicht der Seite dem Editor entspricht.
 */
export function tableLayout(table: DocNode, cellMinWidth: number = COLUMN_WIDTH.min): TableLayout {
  const columns: (number | null)[] = [];
  for (const cell of table.content?.[0]?.content ?? []) {
    const colspan = Number(cell.attrs?.colspan ?? 1);
    const widths = Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as unknown[]) : [];
    for (let i = 0; i < colspan && columns.length < 1000; i++) {
      const w = widths[i];
      columns.push(typeof w === 'number' && w > 0 ? Math.max(w, cellMinWidth) : null);
    }
  }
  if (columns.length === 0) return { columns };
  const total = columns.reduce<number>((sum, w) => sum + (w ?? cellMinWidth), 0);
  return columns.every((w) => w !== null) ? { columns, width: total } : { columns, minWidth: total };
}

export const EMPTY_DOC: DocNode = { type: 'doc', content: [{ type: 'paragraph' }] };

function inlineText(node: DocNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'image') return `[Bild: ${String(node.attrs?.alt ?? node.attrs?.src ?? '')}]`;
  return (node.content ?? []).map(inlineText).join('');
}

/**
 * Zerlegt ein Dokument in Textzeilen, eine je Block. Grundlage für den Versionsvergleich
 * und den Suchtext (Meilenstein 3).
 */
export function docToLines(doc: DocNode): string[] {
  const lines: string[] = [];
  const walk = (node: DocNode, prefix: string) => {
    switch (node.type) {
      case 'paragraph':
        lines.push(prefix + inlineText(node));
        return;
      case 'heading':
        lines.push(`${prefix}${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inlineText(node)}`);
        return;
      case 'codeBlock':
        for (const line of inlineText(node).split('\n')) lines.push(`${prefix}    ${line}`);
        return;
      case 'horizontalRule':
        lines.push(`${prefix}---`);
        return;
      case 'image':
        lines.push(prefix + inlineText(node));
        return;
      case 'tableRow':
        lines.push(`${prefix}| ${(node.content ?? []).map((cell) => docToLines(cell).join(' ').trim()).join(' | ')} |`);
        return;
      case 'listItem': {
        const [first, ...rest] = node.content ?? [];
        if (first) walk(first, `${prefix}• `);
        for (const child of rest) walk(child, `${prefix}  `);
        return;
      }
      case 'blockquote':
        for (const child of node.content ?? []) walk(child, `${prefix}> `);
        return;
      case 'callout':
        for (const child of node.content ?? []) walk(child, `${prefix}[${String(node.attrs?.variant ?? 'info')}] `);
        return;
      default:
        for (const child of node.content ?? []) walk(child, prefix);
    }
  };
  walk(doc, '');
  return lines;
}

/** Reiner Text eines Dokuments, z. B. für Vorschauen und die spätere Volltextsuche */
export function docToText(doc: DocNode): string {
  return docToLines(doc)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}
