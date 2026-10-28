import { crc32 } from 'node:zlib';
import { matchesFormat, officeFormat } from './formats';
import { emptyOfficeFile, NEW_OFFICE_KINDS, zip } from './templates';

/** Liest ein ZIP über das zentrale Verzeichnis und prüft dabei Köpfe und Prüfsummen */
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  expect(pos + buf.readUInt32LE(end + 12)).toBe(end);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
    const size = buf.readUInt32LE(pos + 20);
    const nameLength = buf.readUInt16LE(pos + 28);
    const name = buf.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    const local = buf.readUInt32LE(pos + 42);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    expect(buf.readUInt16LE(local + 8)).toBe(0);
    const data = buf.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    expect(crc32(data)).toBe(buf.readUInt32LE(pos + 16));
    files.set(name, data.toString('utf8'));
    pos += 46 + nameLength;
  }
  return files;
}

const MAIN: Record<string, string> = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' };

describe('Leere Office-Vorlagen', () => {
  it('ZIP mit korrekten Köpfen, Prüfsummen und UTF-8-Namen', () => {
    const files = unzip(zip({ 'a.txt': 'eins', 'ä/b.xml': '<x/>' }));
    expect([...files]).toEqual([
      ['a.txt', 'eins'],
      ['ä/b.xml', '<x/>'],
    ]);
  });

  it.each(NEW_OFFICE_KINDS)('%s ist ein vollständiges OOXML-Paket', (kind) => {
    const file = emptyOfficeFile(kind, 'Bericht <2026> & Co');
    // Typprüfung des Editors (Endung und Inhalt passen zusammen)
    expect(matchesFormat(officeFormat(`x.${kind}`)!, file)).toBe(true);
    const files = unzip(file);
    expect([...files.keys()][0]).toBe('[Content_Types].xml');
    for (const [name, xml] of files) {
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name).toBe(true);
    }

    // Jeder angemeldete Teil existiert
    const parts = [...files.get('[Content_Types].xml')!.matchAll(/PartName="\/([^"]+)"/g)].map((m) => m[1]);
    expect(parts).toContain(MAIN[kind]);
    for (const part of parts) expect(files.has(part), part).toBe(true);

    // Jede Beziehung zeigt auf einen vorhandenen Teil
    for (const [name, xml] of files) {
      if (!name.endsWith('.rels')) continue;
      const base = name.replace(/_rels\/[^/]+$/, '');
      for (const [, target] of xml.matchAll(/Target="([^"]+)"/g)) {
        const resolved = new URL(target, `http://x/${base}`).pathname.slice(1);
        expect(files.has(resolved), `${name} → ${target}`).toBe(true);
      }
    }

    // Titel steht maskiert in den Eigenschaften
    expect(files.get('docProps/core.xml')).toContain('<dc:title>Bericht &lt;2026&gt; &amp; Co</dc:title>');
  });

  it('gleiche Vorlage ergibt dieselben Bytes', () => {
    expect(emptyOfficeFile('xlsx', 'A').equals(emptyOfficeFile('xlsx', 'A'))).toBe(true);
  });
});
