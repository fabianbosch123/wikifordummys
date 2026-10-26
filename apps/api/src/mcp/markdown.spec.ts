import { sanitizeDoc, type DocNode } from '@wiki/shared';
import { docToMarkdown, markdownToDoc } from './markdown';

const SAMPLE = [
  '# Titel',
  '',
  'Hallo **fett**, *kursiv*, ~~weg~~, `code` und [Link](https://example.com).',
  '',
  '- eins',
  '- zwei',
  '  - drei',
  '',
  '3. drei',
  '4. vier',
  '',
  '> [!warning]',
  '> Achtung',
  '',
  '> Zitat',
  '',
  '```bash',
  'echo "hi"',
  '```',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 \\| x |',
  '',
  '![Bild](https://example.com/a.png)',
  '',
  '![Netz](drawing:0b7c7c3e-1111-4222-8333-444455556666?version=2)',
  '',
  '---',
  '',
  'Zeile\\',
  'Umbruch',
  '',
].join('\n');

describe('Markdown für den MCP-Server', () => {
  it('übersetzt Markdown in erlaubte Knoten', () => {
    const doc = markdownToDoc(SAMPLE);
    expect(doc.content?.map((n) => n.type)).toEqual([
      'heading', 'paragraph', 'bulletList', 'orderedList', 'callout', 'blockquote', 'codeBlock', 'table', 'image', 'drawing', 'horizontalRule', 'paragraph',
    ]);
    expect(doc.content?.[3].attrs).toEqual({ start: 3 });
    expect(doc.content?.[4].attrs).toEqual({ variant: 'warning' });
    expect(doc.content?.[6]).toEqual({ type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'echo "hi"' }] });
    expect(doc.content?.[9].attrs).toMatchObject({ attachmentId: '0b7c7c3e-1111-4222-8333-444455556666', version: 2, title: 'Netz' });
    expect(doc.content?.[11].content?.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
    // Ohne Zeichnungs-Fassung (die der MCP-Dienst ergänzt) besteht der Inhalt die Prüfung der API
    expect(() => sanitizeDoc({ ...doc, content: doc.content?.filter((n) => n.type !== 'drawing') })).not.toThrow();
  });

  it('kommt über den Umweg zurück zum selben Inhalt', () => {
    const doc = markdownToDoc(SAMPLE);
    const md = docToMarkdown(doc);
    expect(md).toBe(SAMPLE);
    expect(markdownToDoc(md)).toEqual(doc);
  });

  it('schützt Sonderzeichen im Text', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '# keine Überschrift, *kein* Fett, [kein](link) und 1. keine Liste' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '- auch kein Punkt' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'fett ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'normal' }] },
      ],
    };
    expect(markdownToDoc(docToMarkdown(doc))).toEqual({
      ...doc,
      content: [...doc.content!.slice(0, 2), { type: 'paragraph', content: [{ type: 'text', text: 'fett', marks: [{ type: 'bold' }] }, { type: 'text', text: ' normal' }] }],
    });
  });

  it('lässt HTML als Text stehen und begrenzt Überschriften auf Ebene 4', () => {
    const doc = markdownToDoc('<b>x</b>\n\n###### tief');
    expect(doc.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: '<b>x</b>' }] });
    expect(doc.content?.[1].attrs).toEqual({ level: 4 });
  });

  it('bekommt aus leerem Markdown einen leeren Absatz', () => {
    expect(markdownToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
