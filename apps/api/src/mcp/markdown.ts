import { ContentError, type CalloutVariant, type DocMark, type DocNode } from '@wiki/shared';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

/**
 * Markdown ↔ Seiteninhalt (TipTap-JSON) für den MCP-Server: Claude schreibt und liest Seiten als Markdown.
 * Das Ergebnis geht danach wie jeder andere Inhalt durch sanitizeDoc (S6); hier wird nur übersetzt.
 *
 * Abbildung (CommonMark + GFM-Tabellen und Durchstreichen):
 * - Überschriften # bis ####, tiefere werden zu ####
 * - Hinweisboxen als GitHub-Alert: "> [!info]" (auch note, warning, success sowie NOTE, TIP, IMPORTANT, WARNING, CAUTION)
 * - Zeichnungen als Bild mit der Adresse drawing:<Anhang-ID>?version=<Fassung>
 * Was Markdown nicht kennt (Unterstreichen, Spaltenbreiten, verbundene Zellen), geht beim Umweg verloren.
 */

const md = new MarkdownIt('commonmark', { html: false, linkify: false }).enable(['table', 'strikethrough']);

const DRAWING_SRC = /^drawing:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?version=(\d{1,7}))?$/i;

const ALERTS: Record<string, CalloutVariant> = {
  info: 'info',
  note: 'note',
  warning: 'warning',
  success: 'success',
  tip: 'success',
  important: 'info',
  caution: 'warning',
};

const BLOCK_TYPES: Record<string, string> = {
  paragraph: 'paragraph',
  heading: 'heading',
  bullet_list: 'bulletList',
  ordered_list: 'orderedList',
  list_item: 'listItem',
  blockquote: 'blockquote',
  table: 'table',
  tr: 'tableRow',
  th: 'tableHeader',
  td: 'tableCell',
};

const sameMark = (a: DocMark, b: DocMark) => a.type === b.type && a.attrs?.href === b.attrs?.href;

function pushText(out: DocNode[], text: string, marks: DocMark[]) {
  if (!text) return;
  const last = out[out.length - 1];
  const lastMarks = last?.marks ?? [];
  if (last?.type === 'text' && lastMarks.length === marks.length && lastMarks.every((m, i) => sameMark(m, marks[i]))) {
    last.text += text;
    return;
  }
  out.push(marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text });
}

function imageNode(src: string, alt: string, title: string | null): DocNode {
  const drawing = DRAWING_SRC.exec(src);
  if (drawing) {
    return { type: 'drawing', attrs: { attachmentId: drawing[1].toLowerCase(), version: drawing[2] ? Number(drawing[2]) : null, title: alt || undefined } };
  }
  return { type: 'image', attrs: { src, alt: alt || undefined, title: title || undefined } };
}

/** Inline-Tokens zu Textknoten; Bilder und Zeichnungen kommen als Blöcke zurück (im Editor sind sie keine Inline-Knoten) */
function inline(children: Token[]): DocNode[] {
  const out: DocNode[] = [];
  const marks: DocMark[] = [];
  const close = (type: string) => {
    const i = marks.map((m) => m.type).lastIndexOf(type);
    if (i >= 0) marks.splice(i, 1);
  };
  for (const t of children) {
    switch (t.type) {
      case 'text':
        pushText(out, t.content, marks);
        break;
      case 'softbreak':
        pushText(out, ' ', marks);
        break;
      case 'hardbreak':
        out.push({ type: 'hardBreak' });
        break;
      case 'code_inline':
        pushText(out, t.content, [...marks, { type: 'code' }]);
        break;
      case 'strong_open':
        marks.push({ type: 'bold' });
        break;
      case 'em_open':
        marks.push({ type: 'italic' });
        break;
      case 's_open':
        marks.push({ type: 'strike' });
        break;
      case 'link_open':
        marks.push({ type: 'link', attrs: { href: t.attrGet('href') ?? '' } });
        break;
      case 'strong_close':
        close('bold');
        break;
      case 'em_close':
        close('italic');
        break;
      case 's_close':
        close('strike');
        break;
      case 'link_close':
        close('link');
        break;
      case 'image':
        out.push(imageNode(t.attrGet('src') ?? '', t.children?.map((c) => c.content).join('') ?? t.content, t.attrGet('title')));
        break;
      default:
        // html_inline gibt es nicht (html: false); Unbekanntes als Text behalten statt still zu verlieren
        pushText(out, t.content, marks);
    }
  }
  return out;
}

const isBlockMedia = (n: DocNode) => n.type === 'image' || n.type === 'drawing';

/** Absatz mit Bildern in Absätze und Bild-Blöcke aufteilen */
function splitParagraph(nodes: DocNode[]): DocNode[] {
  const blocks: DocNode[] = [];
  let current: DocNode[] = [];
  const flush = () => {
    // Nur Leerraum und Zeilenumbrüche zwischen Bildern ergeben keinen eigenen Absatz
    const meaningful = current.some((n) => n.type !== 'hardBreak' && !(n.type === 'text' && !n.text?.trim()));
    if (meaningful) blocks.push({ type: 'paragraph', content: current });
    current = [];
  };
  for (const n of nodes) {
    if (isBlockMedia(n)) {
      flush();
      blocks.push(n);
    } else current.push(n);
  }
  flush();
  return blocks.length ? blocks : [{ type: 'paragraph' }];
}

/** "> [!warning]" am Anfang eines Zitats macht daraus eine Hinweisbox */
function toCallout(quote: DocNode): DocNode {
  const [first, ...others] = quote.content ?? [];
  const [text, ...inlineRest] = first?.type === 'paragraph' ? (first.content ?? []) : [];
  const match = text?.type === 'text' && !text.marks ? /^\[!(\w+)\]\s*/.exec(text.text ?? '') : null;
  const variant = match ? ALERTS[match[1].toLowerCase()] : undefined;
  if (!match || !variant) return quote;
  const rest = text.text!.slice(match[0].length);
  const firstContent = [...(rest ? [{ ...text, text: rest }] : []), ...inlineRest];
  const content = [...(firstContent.length ? [{ ...first, content: firstContent }] : []), ...others];
  return { type: 'callout', attrs: { variant }, content: content.length ? content : [{ type: 'paragraph' }] };
}

export function markdownToDoc(markdown: string): DocNode {
  if (markdown.length > 1_000_000) throw new ContentError('Das Dokument ist zu groß.');
  const tokens = md.parse(markdown, {});
  const root: DocNode = { type: 'doc', content: [] };
  const stack: DocNode[] = [root];
  const top = () => stack[stack.length - 1];
  const append = (...nodes: DocNode[]) => {
    const parent = top();
    parent.content = [...(parent.content ?? []), ...nodes];
  };

  for (const t of tokens) {
    if (t.type === 'thead_open' || t.type === 'thead_close' || t.type === 'tbody_open' || t.type === 'tbody_close') continue;
    if (t.nesting === 1) {
      const name = t.type.replace(/_open$/, '');
      const type = BLOCK_TYPES[name];
      if (!type) throw new ContentError(`Nicht unterstütztes Markdown: ${name}`);
      const node: DocNode = { type };
      if (type === 'heading') node.attrs = { level: Math.min(Number(t.tag.slice(1)), 4) };
      if (type === 'orderedList') node.attrs = { start: Number(t.attrGet('start') ?? 1) };
      stack.push(node);
      continue;
    }
    if (t.nesting === -1) {
      const node = stack.pop()!;
      if (node.type === 'paragraph') {
        append(...splitParagraph(node.content ?? []));
        continue;
      }
      if ((node.type === 'tableHeader' || node.type === 'tableCell') && !node.content?.some((c) => c.type === 'paragraph')) {
        node.content = [{ type: 'paragraph', content: node.content }];
        if (!node.content[0].content?.length) delete node.content[0].content;
      }
      if (node.type === 'listItem' && !node.content?.length) node.content = [{ type: 'paragraph' }];
      append(node.type === 'blockquote' ? toCallout(node) : node);
      continue;
    }
    switch (t.type) {
      case 'inline':
        top().content = [...(top().content ?? []), ...inline(t.children ?? [])];
        break;
      case 'fence':
      case 'code_block': {
        const text = t.content.replace(/\n$/, '');
        const language = t.info.trim().split(/\s+/)[0];
        append({ type: 'codeBlock', ...(language ? { attrs: { language } } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) });
        break;
      }
      case 'hr':
        append({ type: 'horizontalRule' });
        break;
      default:
        throw new ContentError(`Nicht unterstütztes Markdown: ${t.type}`);
    }
  }
  if (!root.content?.length) root.content = [{ type: 'paragraph' }];
  return root;
}

// ---------- Seiteninhalt → Markdown ----------

const MARK_ORDER = ['link', 'bold', 'italic', 'strike'];
const DELIMS: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };

function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]~<]/g, '\\$&');
}

/** Zeichen am Zeilenanfang, die sonst eine Liste, Überschrift oder ein Zitat beginnen würden */
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)([#>+-])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || /^ .* $/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function inlineToMarkdown(nodes: DocNode[] = []): string {
  let out = '';
  let active: DocMark[] = [];
  const open = (m: DocMark) => (m.type === 'link' ? '[' : DELIMS[m.type]);
  const close = (m: DocMark) => (m.type === 'link' ? `](${String(m.attrs?.href ?? '').replace(/[()\s]/g, encodeURIComponent)})` : DELIMS[m.type]);
  const transition = (wanted: DocMark[]) => {
    let k = 0;
    while (k < active.length && k < wanted.length && sameMark(active[k], wanted[k])) k++;
    for (let i = active.length - 1; i >= k; i--) out += close(active[i]);
    for (let i = k; i < wanted.length; i++) out += open(wanted[i]);
    active = wanted;
  };
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      out += '\\\n';
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;
    const marks = (node.marks ?? []).filter((m) => MARK_ORDER.includes(m.type)).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    const isCode = node.marks?.some((m) => m.type === 'code');
    // Leerraum am Rand gehört vor bzw. hinter die Markierungen, sonst erkennt Markdown sie nicht
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text)!;
    const shared = () => {
      let k = 0;
      while (k < active.length && k < marks.length && sameMark(active[k], marks[k])) k++;
      return active.slice(0, k);
    };
    if (!core) {
      transition(shared());
      out += node.text;
      continue;
    }
    if (lead) {
      transition(shared());
      out += lead;
    }
    transition(marks);
    out += isCode ? codeSpan(core) : escapeText(core);
    if (trail) {
      transition([]);
      out += trail;
    }
  }
  transition([]);
  return out;
}

const indent = (text: string, first: string, rest: string) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 ? first : line ? rest : '') + line)
    .join('\n');

function cellText(cell: DocNode): string {
  return (cell.content ?? [])
    .map((c) => (c.type === 'paragraph' || c.type === 'heading' ? inlineToMarkdown(c.content) : blockToMarkdown(c).replace(/\n+/g, ' ')))
    .join(' ')
    .replace(/\\\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function blocksToMarkdown(nodes: DocNode[] = [], tight = false): string {
  return nodes.map((n) => blockToMarkdown(n)).join(tight ? '\n' : '\n\n');
}

/** Listenpunkte eng schreiben, außer sie enthalten mehrere Absätze (die sonst zu einem verschmelzen) */
function itemToMarkdown(item: DocNode): string {
  const paragraphs = (item.content ?? []).filter((c) => c.type !== 'bulletList' && c.type !== 'orderedList').length;
  return blocksToMarkdown(item.content, paragraphs <= 1);
}

function blockToMarkdown(node: DocNode): string {
  switch (node.type) {
    case 'paragraph':
      return inlineToMarkdown(node.content)
        .split('\n')
        .map(escapeLineStart)
        .join('\n');
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inlineToMarkdown(node.content)}`;
    case 'bulletList':
      return (node.content ?? []).map((item) => indent(itemToMarkdown(item), '- ', '  ')).join('\n');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((item, i) => {
          const marker = `${start + i}. `;
          return indent(itemToMarkdown(item), marker, ' '.repeat(marker.length));
        })
        .join('\n');
    }
    case 'blockquote':
      return indent(blocksToMarkdown(node.content), '> ', '> ').replace(/^$/gm, '>');
    case 'callout':
      return indent(`[!${String(node.attrs?.variant ?? 'info')}]\n${blocksToMarkdown(node.content)}`, '> ', '> ').replace(/^$/gm, '>');
    case 'codeBlock': {
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((r) => r.length));
      const fence = '`'.repeat(longest + 1);
      return `${fence}${String(node.attrs?.language ?? '')}\n${text}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    case 'image':
      return `![${escapeText(String(node.attrs?.alt ?? ''))}](${String(node.attrs?.src ?? '').replace(/[()\s]/g, encodeURIComponent)})`;
    case 'drawing':
      return `![${escapeText(String(node.attrs?.title ?? 'Zeichnung'))}](drawing:${String(node.attrs?.attachmentId)}?version=${String(node.attrs?.version)})`;
    case 'table': {
      const rows = (node.content ?? []).map((row) => (row.content ?? []).map(cellText));
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
      return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return blocksToMarkdown(node.content);
  }
}

export function docToMarkdown(doc: DocNode): string {
  return blocksToMarkdown(doc.content).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
