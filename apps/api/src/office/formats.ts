/**
 * Office-Formate, die der Editor öffnet. Erkannt wird am Dateinamen, geprüft wird zusätzlich der Inhalt:
 * OOXML und OpenDocument sind ZIP-Archive, die alten Binärformate OLE-Container. So landet keine
 * umbenannte Datei anderen Typs im Editor.
 */
export type DocumentType = 'word' | 'cell' | 'slide';

export interface OfficeFormat {
  /** Dateiendung, wie sie der Editor als fileType erwartet */
  fileType: string;
  documentType: DocumentType;
  /** false = nur ansehen (alte Binärformate würde der Editor beim Speichern umwandeln) */
  editable: boolean;
  container: 'zip' | 'ole';
}

const FORMATS: Record<string, Omit<OfficeFormat, 'fileType'>> = {
  docx: { documentType: 'word', editable: true, container: 'zip' },
  odt: { documentType: 'word', editable: true, container: 'zip' },
  xlsx: { documentType: 'cell', editable: true, container: 'zip' },
  ods: { documentType: 'cell', editable: true, container: 'zip' },
  pptx: { documentType: 'slide', editable: true, container: 'zip' },
  odp: { documentType: 'slide', editable: true, container: 'zip' },
  doc: { documentType: 'word', editable: false, container: 'ole' },
  xls: { documentType: 'cell', editable: false, container: 'ole' },
  ppt: { documentType: 'slide', editable: false, container: 'ole' },
};

const MAGIC: Record<OfficeFormat['container'], Buffer> = {
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  ole: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};

export const OFFICE_MAGIC_BYTES = 8;

export function officeFormat(filename: string): OfficeFormat | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 1) return null;
  const fileType = filename.slice(dot + 1).toLowerCase();
  const format = FORMATS[fileType];
  return format ? { fileType, ...format } : null;
}

/** Passt der Dateianfang zum Format? */
export function matchesFormat(format: OfficeFormat, head: Buffer): boolean {
  const magic = MAGIC[format.container];
  return head.length >= magic.length && head.subarray(0, magic.length).equals(magic);
}
