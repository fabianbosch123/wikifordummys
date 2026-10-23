/**
 * Erkennt den Dateityp am Inhalt statt an Dateiname oder mitgeschicktem Content-Type (S7).
 * Nur diese Typen werden im Browser angezeigt; alles andere, auch HTML und SVG,
 * wird als application/octet-stream und nur zum Herunterladen ausgeliefert.
 */
export interface DetectedType {
  mimeType: string;
  preview: 'image' | 'pdf' | null;
}

export const SNIFF_BYTES = 16;

const OCTET_STREAM: DetectedType = { mimeType: 'application/octet-stream', preview: null };

const startsWith = (head: Buffer, bytes: number[] | string, offset = 0) => {
  const expected = typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes);
  return head.length >= offset + expected.length && head.subarray(offset, offset + expected.length).equals(expected);
};

export function detectType(head: Buffer): DetectedType {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: 'image/png', preview: 'image' };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', preview: 'image' };
  if (startsWith(head, 'GIF87a') || startsWith(head, 'GIF89a')) return { mimeType: 'image/gif', preview: 'image' };
  if (startsWith(head, 'RIFF') && startsWith(head, 'WEBP', 8)) return { mimeType: 'image/webp', preview: 'image' };
  if (startsWith(head, '%PDF-')) return { mimeType: 'application/pdf', preview: 'pdf' };
  return OCTET_STREAM;
}

export function previewOf(mimeType: string): DetectedType['preview'] {
  if (mimeType === 'application/pdf') return 'pdf';
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType) ? 'image' : null;
}

/** Nur der Dateiname ohne Pfad und Steuerzeichen, höchstens 200 Zeichen */
export function cleanFilename(raw: string): string {
  const base = raw.normalize('NFC').split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const name = cleaned === '.' || cleaned === '..' ? '' : cleaned;
  return Array.from(name).slice(0, 200).join('') || 'datei';
}

/** Content-Disposition nach RFC 6266 mit ASCII-Ersatz und UTF-8-Namen */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
