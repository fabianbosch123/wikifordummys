import { DRAWING_LIMITS, IMAGE_SIZE } from '@wiki/shared';

/**
 * draw.io (diagrams.net) läuft als eigener Dienst unter /draw/ auf derselben Domain, eingebettet als Rahmen.
 * Der Rahmen ist abgeschottet (sandbox ohne allow-same-origin, zusätzlich per CSP von Caddy): Er kommt weder an
 * Cookies noch an die API des Wikis. Inhalt geht nur über postMessage hin und her (Embed-Modus, Protokoll json).
 * Externe Dienste von draw.io sind abgeschaltet (stealth); Caddy erlaubt dem Rahmen nur Verbindungen zu /draw/.
 * https://www.drawio.com/doc/faq/embed-mode
 */
export const DRAWIO_URL =
  '/draw/index.html?embed=1&proto=json&spin=1&lang=de&stealth=1&saveAndExit=1&noSaveBtn=1&configure=1&libraries=1';

/** Gleiche Rechte wie in der CSP von Caddy (sandbox); Herunterladen und Drucken bleiben möglich */
export const DRAWIO_SANDBOX = 'allow-scripts allow-downloads allow-popups allow-modals';

/** Einstellungen für draw.io: Formen für Netzwerkpläne gleich in der Seitenleiste, Daten unkomprimiert lesbar */
export const DRAWIO_CONFIG = {
  defaultLibraries: 'general;basic;arrows2;flowchart;network2;network;rack;cisco19',
  compressXml: false,
};

/** Zeichnungen werden mit doppelter Auflösung gespeichert, damit sie auf hochauflösenden Bildschirmen scharf bleiben */
export const EXPORT_SCALE = 2;

/** Nachricht von draw.io; alles andere (z. B. von Browser-Erweiterungen) wird ignoriert */
export interface DrawioMessage {
  event: string;
  xml?: string;
  data?: string;
  exit?: boolean;
  modified?: boolean;
  message?: string;
}

export function parseMessage(data: unknown): DrawioMessage | null {
  if (typeof data !== 'string' || data.length > 50_000_000) return null;
  try {
    const msg = JSON.parse(data) as unknown;
    return msg && typeof msg === 'object' && typeof (msg as DrawioMessage).event === 'string' ? (msg as DrawioMessage) : null;
  } catch {
    return null;
  }
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Beschriftungen einer Zeichnung als Text für Suche und Versionsvergleich, eine je Form.
 * Beschriftungen können HTML sein; der Text kommt über DOMParser heraus (führt nichts aus).
 */
export function drawingText(xml: string | undefined): string {
  if (!xml) return '';
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) return '';
  const seen = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll('mxCell[value], UserObject[label], object[label]'))) {
    const raw = el.getAttribute(el.tagName === 'mxCell' ? 'value' : 'label') ?? '';
    const text = collapse(raw.includes('<') ? (new DOMParser().parseFromString(raw, 'text/html').body.textContent ?? '') : raw);
    if (text) seen.add(text);
  }
  return Array.from(seen).join('\n').slice(0, DRAWING_LIMITS.maxText);
}

/** data:-Adresse von draw.io als Datei (selbst dekodiert: die CSP des Wikis erlaubt kein fetch auf data:) */
export function dataUrlToBlob(dataUrl: string): Blob {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('draw.io hat kein PNG geliefert.');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Datei nicht lesbar'));
    reader.readAsDataURL(blob);
  });
}

/** Anzeigegröße in Pixeln (PNG mit doppelter Auflösung), in den Grenzen der Inhaltsprüfung */
export async function displaySize(png: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(png);
  const clamp = (v: number) => Math.min(Math.max(Math.round(v / EXPORT_SCALE), IMAGE_SIZE.min), IMAGE_SIZE.max);
  const size = { width: clamp(bitmap.width), height: clamp(bitmap.height) };
  bitmap.close();
  return size;
}

/** Dateiname des Anhangs: Titel der Zeichnung, mit .drawio.png lässt sie sich auch in draw.io Desktop öffnen */
export function drawingFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const base = title.replace(/[/\\\u0000-\u001f]/g, ' ').trim().slice(0, 150) || 'Zeichnung';
  return `${base}.drawio.png`;
}
