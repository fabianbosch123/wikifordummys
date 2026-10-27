import { crc32, inflateRawSync, inflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { DRAWING_LIMITS, IMAGE_SIZE } from '@wiki/shared';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

/**
 * Zeichnungen aus draw.io-XML für den MCP-Server.
 *
 * Im Wiki ist eine Zeichnung ein PNG mit eingebetteten draw.io-Daten (tEXt-Block „mxfile“, wie draw.io selbst
 * speichert). Claude liefert nur das XML; das Bild dazu zeichnet diese Datei vereinfacht selbst: Rechtecke,
 * abgerundete Rechtecke, Ellipsen, Rauten, Zylinder, Text und Verbindungen mit Pfeilen und Beschriftungen.
 * Spezielle Symbole (z. B. Cisco-Icons) erscheinen als beschriftetes Rechteck. Sobald jemand die Zeichnung im
 * Wiki mit draw.io öffnet und speichert, erzeugt draw.io das exakte Bild.
 */

export const MAX_DRAWING_XML = 1_000_000;
/**
 * Obergrenze für entpackte Daten (komprimierte Seiten, zTXt-Blöcke) je Zeichnung, zusammengezählt über alle Seiten.
 * Schutz vor Entpack-Bomben: deflate packt gleichförmige Daten etwa 1:1000. URI-kodiertes XML ist bis zu dreimal so lang.
 */
export const MAX_INFLATED = 3 * MAX_DRAWING_XML;
const MAX_CELLS = 5_000;
/** Doppelte Auflösung wie beim Speichern aus draw.io (EXPORT_SCALE in der Weboberfläche) */
const SCALE = 2;
const PAD = 10;
const FONT = 'DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif';

export class DrawingError extends Error {}

// ---------- XML lesen ----------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ['mxCell', 'object', 'UserObject', 'mxPoint', 'diagram'].includes(name),
});
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '', suppressEmptyNode: true, processEntities: true });

type XmlNode = Record<string, unknown>;

function parseXml(xml: string): XmlNode {
  // Kein DTD: schließt Entity-Tricks (Billion Laughs, externe Entities) von vornherein aus
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new DrawingError('Das XML darf keine DOCTYPE- oder ENTITY-Angaben enthalten.');
  try {
    return parser.parse(xml, true) as XmlNode;
  } catch (err) {
    throw new DrawingError(`Ungültiges XML: ${err instanceof Error ? err.message.slice(0, 200) : 'unbekannter Fehler'}`);
  }
}

/** Entpackt höchstens maxBytes; mehr gilt als Fehler (zlib bricht dann selbst ab, ohne den Speicher zu füllen) */
function inflateLimited(inflate: typeof inflateSync, data: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0) throw new DrawingError('Die Zeichnung ist entpackt zu groß.');
  try {
    return inflate(data, { maxOutputLength: maxBytes });
  } catch (err) {
    if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new DrawingError('Die Zeichnung ist entpackt zu groß.');
    }
    throw err;
  }
}

/** Komprimierte Diagramme (Standard in draw.io Desktop): Base64 → deflate (raw) → URI-kodiert */
function decompressDiagram(text: string, maxBytes: number): string {
  let raw: Buffer;
  try {
    raw = inflateLimited(inflateRawSync, Buffer.from(text.trim(), 'base64'), maxBytes);
  } catch (err) {
    if (err instanceof DrawingError) throw err;
    throw new DrawingError('Das komprimierte Diagramm ließ sich nicht entpacken.');
  }
  try {
    return decodeURIComponent(raw.toString('latin1'));
  } catch {
    throw new DrawingError('Das komprimierte Diagramm ließ sich nicht entpacken.');
  }
}

interface Diagram {
  name: string;
  id: string;
  model: XmlNode;
}

/**
 * Liest draw.io-XML: <mxfile> mit einer oder mehreren <diagram> (unkomprimiert oder komprimiert)
 * oder ein einzelnes <mxGraphModel>. Ergebnis: alle Seiten mit unkomprimiertem Modell.
 */
export function parseDrawio(xml: string): Diagram[] {
  if (xml.length > MAX_DRAWING_XML) throw new DrawingError('Die Zeichnung ist zu groß (höchstens 1 MB XML).');
  const doc = parseXml(xml.trim());
  if (doc.mxGraphModel) return [{ name: 'Seite-1', id: 'seite-1', model: doc.mxGraphModel as XmlNode }];
  const file = doc.mxfile as XmlNode | undefined;
  const diagrams = (file?.diagram as XmlNode[] | undefined) ?? [];
  if (!diagrams.length) throw new DrawingError('Erwartet wird <mxfile> mit <diagram> oder ein <mxGraphModel>.');
  // Budget für alle Seiten zusammen: viele kleine Bomben dürfen sich nicht aufsummieren
  let budget = MAX_INFLATED;
  return diagrams.map((d, i) => {
    let model = d.mxGraphModel as XmlNode | undefined;
    const text = typeof d['#text'] === 'string' ? d['#text'].trim() : '';
    if (!model && text) {
      const inner = decompressDiagram(text, budget);
      budget -= inner.length;
      model = parseXml(inner).mxGraphModel as XmlNode | undefined;
    }
    if (!model) throw new DrawingError(`Seite ${i + 1} der Zeichnung enthält kein <mxGraphModel>.`);
    return { name: String(d.name ?? `Seite-${i + 1}`), id: String(d.id ?? `seite-${i + 1}`), model };
  });
}

/** Unkomprimiertes <mxfile>, so wie es eingebettet und an Claude zurückgegeben wird */
export function toMxfile(diagrams: Diagram[]): string {
  return builder.build({
    mxfile: { host: 'wikifordummys', diagram: diagrams.map((d) => ({ name: d.name, id: d.id, mxGraphModel: d.model })) },
  }) as string;
}

// ---------- Zellen ----------

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  relative: boolean;
  points: Point[];
  sourcePoint?: Point;
  targetPoint?: Point;
}

interface Point {
  x: number;
  y: number;
}

interface Cell {
  id: string;
  parent?: string;
  value: string;
  style: Record<string, string>;
  /** Erster Teil des Stils ohne „=“, z. B. ellipse oder text */
  baseStyle: string;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
  geometry?: Geometry;
}

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

function point(p: XmlNode): Point {
  return { x: num(p.x), y: num(p.y) };
}

function parseStyle(style: string): { style: Record<string, string>; baseStyle: string } {
  const result: Record<string, string> = {};
  let baseStyle = '';
  for (const part of style.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) baseStyle ||= part;
    else result[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { style: result, baseStyle };
}

function parseGeometry(g: XmlNode | undefined): Geometry | undefined {
  if (!g) return undefined;
  const geo: Geometry = {
    x: num(g.x),
    y: num(g.y),
    width: num(g.width),
    height: num(g.height),
    relative: g.relative === '1',
    points: [],
  };
  for (const p of (g.mxPoint as XmlNode[] | undefined) ?? []) {
    if (p.as === 'sourcePoint') geo.sourcePoint = point(p);
    if (p.as === 'targetPoint') geo.targetPoint = point(p);
  }
  const arr = g.Array as XmlNode | undefined;
  if (arr?.as === 'points') geo.points = ((arr.mxPoint as XmlNode[] | undefined) ?? []).map(point);
  return geo;
}

function toCell(raw: XmlNode, wrapper?: XmlNode): Cell {
  const { style, baseStyle } = parseStyle(String(raw.style ?? ''));
  return {
    id: String(wrapper?.id ?? raw.id ?? ''),
    parent: raw.parent !== undefined ? String(raw.parent) : undefined,
    value: String(wrapper ? (wrapper.label ?? '') : (raw.value ?? '')),
    style,
    baseStyle,
    vertex: raw.vertex === '1',
    edge: raw.edge === '1',
    source: raw.source !== undefined ? String(raw.source) : undefined,
    target: raw.target !== undefined ? String(raw.target) : undefined,
    geometry: parseGeometry(raw.mxGeometry as XmlNode | undefined),
  };
}

function cellsOf(model: XmlNode): Cell[] {
  const root = model.root as XmlNode | undefined;
  if (!root) return [];
  const cells: Cell[] = [];
  for (const raw of (root.mxCell as XmlNode[] | undefined) ?? []) cells.push(toCell(raw));
  // Formen mit eigenen Eigenschaften: <object label="…"><mxCell …/></object>
  for (const key of ['object', 'UserObject']) {
    for (const wrapper of (root[key] as XmlNode[] | undefined) ?? []) {
      const inner = (wrapper.mxCell as XmlNode[] | undefined)?.[0];
      if (inner) cells.push(toCell(inner, wrapper));
    }
  }
  if (cells.length > MAX_CELLS) throw new DrawingError(`Die Zeichnung hat zu viele Elemente (höchstens ${MAX_CELLS}).`);
  return cells;
}

// ---------- Text der Beschriftungen ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Beschriftung als reiner Text; HTML-Beschriftungen (html=1) ohne Tags, Zeilenumbrüche bleiben */
export function labelText(value: string, html: boolean): string {
  if (!html) return value;
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Beschriftungen für Suche und Versionsvergleich, eine je Form (wie drawingText in der Weboberfläche) */
export function drawingSearchText(diagrams: Diagram[]): string {
  const seen = new Set<string>();
  for (const d of diagrams) {
    for (const c of cellsOf(d.model)) {
      const text = labelText(c.value, c.style.html === '1').replace(/\s+/g, ' ').trim();
      if (text) seen.add(text);
    }
  }
  return Array.from(seen).join('\n').slice(0, DRAWING_LIMITS.maxText);
}

// ---------- Vereinfachtes Bild als SVG ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Nur Farben, die resvg sicher versteht; alles andere (z. B. „default“) fällt auf den Standard zurück */
function color(value: string | undefined, fallback: string): string {
  if (value === 'none') return 'none';
  if (value && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) return value;
  if (value && /^[a-z]{3,20}$/i.test(value) && value !== 'default') return value.toLowerCase();
  return fallback;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const center = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Schnittpunkt der Linie vom Mittelpunkt der Form zu p mit ihrem Rand (Rechteck bzw. Ellipse) */
function borderPoint(box: Box, toward: Point, ellipse: boolean): Point {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = box.width / 2;
  const hh = box.height / 2;
  if (ellipse && hw > 0 && hh > 0) {
    const t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function wrapLines(text: string, maxWidth: number, fontSize: number, wrap: boolean): string[] {
  const lines = text.split('\n');
  if (!wrap || maxWidth <= 0) return lines;
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.58)));
  const out: string[] = [];
  for (const line of lines) {
    let current = '';
    for (const word of line.split(/\s+/)) {
      if (!current) current = word;
      else if ((current + ' ' + word).length <= maxChars) current += ' ' + word;
      else {
        out.push(current);
        current = word;
      }
    }
    out.push(current);
  }
  return out;
}

function textSvg(
  text: string,
  box: Box,
  style: Record<string, string>,
  opts: { wrap: boolean; background?: boolean },
): string {
  if (!text) return '';
  const fontSize = num(style.fontSize, 12);
  const fontStyle = num(style.fontStyle, 0);
  const align = style.align ?? 'center';
  const vAlign = style.verticalAlign ?? 'middle';
  const lines = wrapLines(text, box.width - 4, fontSize, opts.wrap);
  const lineHeight = fontSize * 1.2;
  const total = lines.length * lineHeight;
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const x = align === 'left' ? box.x + 4 : align === 'right' ? box.x + box.width - 4 : box.x + box.width / 2;
  const top = vAlign === 'top' ? box.y + 4 : vAlign === 'bottom' ? box.y + box.height - total - 4 : box.y + (box.height - total) / 2;
  const attrs = [
    `font-family="${FONT}"`,
    `font-size="${fontSize}"`,
    `fill="${color(style.fontColor, '#000000')}"`,
    `text-anchor="${anchor}"`,
    fontStyle & 1 ? 'font-weight="bold"' : '',
    fontStyle & 2 ? 'font-style="italic"' : '',
    fontStyle & 4 ? 'text-decoration="underline"' : '',
  ].filter(Boolean);
  let bg = '';
  if (opts.background) {
    const width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.6 + 6;
    const bx = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    bg = `<rect x="${bx}" y="${top}" width="${width}" height="${total}" fill="#ffffff"/>`;
  }
  const spans = lines.map((l, i) => `<tspan x="${x}" y="${top + i * lineHeight + fontSize * 0.95}">${esc(l)}</tspan>`).join('');
  return `${bg}<text ${attrs.join(' ')}>${spans}</text>`;
}

function shapeSvg(cell: Cell, box: Box): string {
  const s = cell.style;
  const shape = s.shape ?? cell.baseStyle;
  if (shape === 'text' || cell.baseStyle === 'text' || cell.baseStyle === 'edgeLabel') return '';
  const fill = color(s.fillColor, '#ffffff');
  const stroke = color(s.strokeColor, '#000000');
  const width = num(s.strokeWidth, 1);
  const dash = s.dashed === '1' ? ` stroke-dasharray="${3 * width} ${3 * width}"` : '';
  const opacity = s.opacity ? ` opacity="${Math.min(Math.max(num(s.opacity, 100), 0), 100) / 100}"` : '';
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash}${opacity}`;
  const { x, y, width: w, height: h } = box;
  switch (shape) {
    case 'ellipse':
    case 'doubleEllipse':
    case 'cloud':
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
    case 'rhombus':
      return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${common}/>`;
    case 'triangle':
      return `<polygon points="${x},${y} ${x + w},${y + h / 2} ${x},${y + h}" ${common}/>`;
    case 'hexagon': {
      const d = Math.min(w / 4, 20);
      return `<polygon points="${x + d},${y} ${x + w - d},${y} ${x + w},${y + h / 2} ${x + w - d},${y + h} ${x + d},${y + h} ${x},${y + h / 2}" ${common}/>`;
    }
    case 'cylinder':
    case 'cylinder3':
    case 'datastore': {
      const ry = Math.min(h / 6, 15);
      return (
        `<path d="M${x},${y + ry} L${x},${y + h - ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + h - ry} L${x + w},${y + ry} A${w / 2},${ry} 0 0 0 ${x},${y + ry} Z" ${common}/>` +
        `<path d="M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`
      );
    }
    default: {
      const rounded = s.rounded === '1';
      const r = rounded ? Math.min(num(s.arcSize, 15) / 100 * Math.min(w, h), w / 2, h / 2) : 0;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${common}/>`;
    }
  }
}

function arrowSvg(from: Point, to: Point, stroke: string, filled: boolean): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const len = 9;
  const spread = Math.PI / 7;
  const a = { x: to.x - len * Math.cos(angle - spread), y: to.y - len * Math.sin(angle - spread) };
  const b = { x: to.x - len * Math.cos(angle + spread), y: to.y - len * Math.sin(angle + spread) };
  return `<polygon points="${to.x},${to.y} ${a.x},${a.y} ${b.x},${b.y}" fill="${filled ? stroke : '#ffffff'}" stroke="${stroke}"/>`;
}

/** Punkt auf halber Länge eines Linienzugs, für Beschriftungen von Verbindungen */
function midpoint(points: Point[]): Point {
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let rest = segs.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < segs.length; i++) {
    if (rest <= segs[i] && segs[i] > 0) {
      const t = rest / segs[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    rest -= segs[i];
  }
  return points[0];
}

interface Rendered {
  svg: string;
  /** Größe in Pixeln bei Maßstab 1 (Anzeigegröße auf der Seite) */
  width: number;
  height: number;
}

/** Zeichnet die erste Seite der Zeichnung vereinfacht als SVG */
export function renderSvg(diagram: Diagram): Rendered {
  const cells = cellsOf(diagram.model);
  const byId = new Map(cells.map((c) => [c.id, c]));

  // Absolute Lage: Kinder von Gruppen und Containern liegen relativ zu ihrem Elternelement
  const boxes = new Map<string, Box>();
  const absolute = (cell: Cell, depth = 0): Box | null => {
    if (boxes.has(cell.id)) return boxes.get(cell.id)!;
    if (!cell.vertex || !cell.geometry || depth > 50) return null;
    const parent = cell.parent ? byId.get(cell.parent) : undefined;
    const offset = parent?.vertex ? absolute(parent, depth + 1) : null;
    const g = cell.geometry;
    const box = { x: g.x + (offset?.x ?? 0), y: g.y + (offset?.y ?? 0), width: g.width, height: g.height };
    boxes.set(cell.id, box);
    return box;
  };

  const vertices: { cell: Cell; box: Box }[] = [];
  const edgeLabels = new Map<string, Cell[]>();
  for (const cell of cells) {
    if (!cell.vertex) continue;
    const parent = cell.parent ? byId.get(cell.parent) : undefined;
    if (parent?.edge) {
      edgeLabels.set(parent.id, [...(edgeLabels.get(parent.id) ?? []), cell]);
      continue;
    }
    const box = absolute(cell);
    if (box && box.width >= 0 && box.height >= 0) vertices.push({ cell, box });
  }

  const edges: { cell: Cell; points: Point[] }[] = [];
  for (const cell of cells) {
    if (!cell.edge) continue;
    const g = cell.geometry ?? { points: [] as Point[] };
    const src = cell.source ? boxes.get(cell.source) : undefined;
    const tgt = cell.target ? boxes.get(cell.target) : undefined;
    const ellipse = (id?: string) => ['ellipse', 'doubleEllipse', 'cloud'].includes(byId.get(id ?? '')?.style.shape ?? byId.get(id ?? '')?.baseStyle ?? '');
    const via = g.points ?? [];
    const startRef = src ? center(src) : (g as Geometry).sourcePoint;
    const endRef = tgt ? center(tgt) : (g as Geometry).targetPoint;
    if (!startRef || !endRef) continue;
    let inner = via;
    const orthogonal = cell.style.edgeStyle === 'orthogonalEdgeStyle' || cell.style.edgeStyle === 'elbowEdgeStyle';
    if (orthogonal && !via.length && src && tgt) {
      const a = center(src);
      const b = center(tgt);
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      if (horizontal && Math.abs(b.y - a.y) > 1) inner = [{ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }];
      if (!horizontal && Math.abs(b.x - a.x) > 1) inner = [{ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }];
    }
    const start = src ? borderPoint(src, inner[0] ?? endRef, ellipse(cell.source)) : startRef;
    const end = tgt ? borderPoint(tgt, inner[inner.length - 1] ?? startRef, ellipse(cell.target)) : endRef;
    edges.push({ cell, points: [start, ...inner, end] });
  }

  // Ausmaß der Zeichnung
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { box } of vertices) {
    xs.push(box.x, box.x + box.width);
    ys.push(box.y, box.y + box.height);
  }
  for (const p of edges.flatMap((e) => e.points)) {
    xs.push(p.x);
    ys.push(p.y);
  }
  if (!xs.length) throw new DrawingError('Die Zeichnung ist leer: keine Formen oder Verbindungen mit Lage (mxGeometry).');
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const width = Math.ceil(Math.max(...xs) + PAD - minX);
  const height = Math.ceil(Math.max(...ys) + PAD - minY);
  if (width > IMAGE_SIZE.max || height > IMAGE_SIZE.max) {
    throw new DrawingError(`Die Zeichnung ist zu groß (höchstens ${IMAGE_SIZE.max} × ${IMAGE_SIZE.max} Pixel).`);
  }

  const parts: string[] = [];
  // Container und Gruppen zuerst, damit ihre Kinder darüber liegen (Reihenfolge wie im Modell)
  for (const { cell, box } of vertices) {
    parts.push(shapeSvg(cell, box));
    const html = cell.style.html === '1';
    const swimlane = cell.style.swimlane !== undefined || cell.baseStyle === 'swimlane';
    const labelBox = swimlane ? { ...box, height: Math.min(num(cell.style.startSize, 23), box.height) } : box;
    parts.push(textSvg(labelText(cell.value, html), labelBox, cell.style, { wrap: cell.style.whiteSpace === 'wrap' || html }));
  }
  for (const { cell, points } of edges) {
    const s = cell.style;
    const stroke = color(s.strokeColor, '#000000');
    const w = num(s.strokeWidth, 1);
    const dash = s.dashed === '1' ? ` stroke-dasharray="${3 * w} ${3 * w}"` : '';
    parts.push(`<polyline points="${points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}"${dash}/>`);
    const endArrow = s.endArrow ?? 'classic';
    if (endArrow !== 'none') parts.push(arrowSvg(points[points.length - 2], points[points.length - 1], stroke, s.endFill !== '0'));
    if (s.startArrow && s.startArrow !== 'none') parts.push(arrowSvg(points[1], points[0], stroke, s.startFill !== '0'));
    const mid = midpoint(points);
    const labels = [cell, ...(edgeLabels.get(cell.id) ?? [])].map((c) => labelText(c.value, c.style.html === '1')).filter(Boolean);
    for (const [i, text] of labels.entries()) {
      const fontSize = num(s.fontSize, 11);
      parts.push(textSvg(text, { x: mid.x - 100, y: mid.y - fontSize + i * fontSize * 1.4, width: 200, height: fontSize * 2 }, { ...s, fontSize: String(fontSize) }, { wrap: false, background: true }));
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">` +
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#ffffff"/>${parts.join('')}</svg>`;
  return { svg, width, height };
}

// ---------- PNG ----------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function* chunks(png: Buffer): Generator<{ type: string; data: Buffer; start: number; end: number }> {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new DrawingError('Kein PNG.');
  let pos = 8;
  while (pos + 12 <= png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > png.length) break;
    yield { type, data: png.subarray(pos + 8, pos + 8 + length), start: pos, end };
    pos = end;
  }
}

const isDrawioChunk = (type: string, data: Buffer) =>
  (type === 'tEXt' || type === 'zTXt') && /^(mxfile|mxGraphModel)\0/.test(data.toString('latin1', 0, 13));

/**
 * Bettet das XML wie draw.io ein: tEXt-Block „mxfile“ mit URI-kodiertem XML direkt nach dem Kopf (IHDR).
 * Schon vorhandene draw.io-Blöcke fallen weg, damit beim Lesen eindeutig ist, welches XML gilt.
 */
export function embedXml(png: Buffer, xml: string): Buffer {
  const parts: Buffer[] = [PNG_SIGNATURE];
  for (const c of chunks(png)) {
    if (isDrawioChunk(c.type, c.data)) continue;
    parts.push(png.subarray(c.start, c.end));
    if (c.type === 'IHDR') parts.push(chunk('tEXt', Buffer.concat([Buffer.from('mxfile\0', 'latin1'), Buffer.from(encodeURIComponent(xml), 'latin1')])));
  }
  if (parts.length < 3) throw new DrawingError('Kein gültiges PNG.');
  return Buffer.concat(parts);
}

/** Liest das eingebettete draw.io-XML aus einem PNG (tEXt „mxfile“ oder älteres zTXt „mxGraphModel“) */
export function extractXml(png: Buffer): string | null {
  for (const c of chunks(png)) {
    if (c.type === 'IEND') break;
    const zero = c.data.indexOf(0);
    if (zero < 0) continue;
    const key = c.data.toString('latin1', 0, zero);
    try {
      if (c.type === 'tEXt' && key === 'mxfile') return decodeURIComponent(c.data.toString('latin1', zero + 1));
      // zTXt: Schlüssel, 0, Kompressionsverfahren (0 = deflate mit zlib-Kopf)
      if (c.type === 'zTXt' && key === 'mxGraphModel') {
        return decodeURIComponent(inflateLimited(inflateSync, c.data.subarray(zero + 2), MAX_INFLATED).toString('latin1'));
      }
    } catch {
      return null;
    }
  }
  return null;
}

export interface RenderedDrawing {
  png: Buffer;
  /** Unkomprimiertes mxfile, wie es eingebettet ist */
  xml: string;
  /** Anzeigegröße auf der Seite */
  width: number;
  height: number;
  /** Beschriftungen für die Suche */
  text: string;
}

/** Aus draw.io-XML eine Zeichnung fürs Wiki machen: vereinfachtes Bild mit eingebettetem XML */
export function renderDrawing(xml: string): RenderedDrawing {
  const diagrams = parseDrawio(xml);
  const { svg, width, height } = renderSvg(diagrams[0]);
  const png = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: SCALE },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    background: '#ffffff',
  })
    .render()
    .asPng();
  const mxfile = toMxfile(diagrams);
  const clamp = (v: number) => Math.min(Math.max(Math.round(v), IMAGE_SIZE.min), IMAGE_SIZE.max);
  return { png: embedXml(png, mxfile), xml: mxfile, width: clamp(width), height: clamp(height), text: drawingSearchText(diagrams) };
}

/** XML einer gespeicherten Zeichnung lesbar machen: komprimierte Seiten entpacken */
export function readableXml(png: Buffer): string | null {
  const xml = extractXml(png);
  if (!xml) return null;
  try {
    return toMxfile(parseDrawio(xml));
  } catch {
    return xml;
  }
}
