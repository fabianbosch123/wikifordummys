import { ContentError, docToLines, docToText, drawingSrc, sanitizeDoc, tableLayout, type DocNode } from '@wiki/shared';

const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const p = (text: string, marks?: DocNode['marks']): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text, marks }] });

describe('Inhaltsprüfung (S6)', () => {
  it('lässt die Knoten des Editors unverändert durch', () => {
    const input = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titel' }] },
      p('fett', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.de/a?b=1' } }]),
      { type: 'codeBlock', attrs: { language: 'TypeScript' }, content: [{ type: 'text', text: 'const a = 1;' }] },
      { type: 'callout', attrs: { variant: 'warning' }, content: [p('Achtung')] },
      { type: 'image', attrs: { src: 'https://example.de/bild.png', alt: 'Bild' } },
      {
        type: 'table',
        content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p('A')] }] }],
      },
    );
    const out = sanitizeDoc(input);
    expect(out.content?.[0]).toEqual({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titel' }] });
    expect(out.content?.[2].attrs).toEqual({ language: 'typescript' });
    expect(out.content?.[3].attrs).toEqual({ variant: 'warning' });
    expect(out.content?.[5].content?.[0].content?.[0].attrs).toEqual({ colspan: 1, rowspan: 1 });
  });

  it('entfernt unbekannte Attribute wie Event-Handler und Link-Ziele', () => {
    const out = sanitizeDoc(
      doc({
        type: 'paragraph',
        attrs: { onclick: 'alert(1)', style: 'x' },
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: '/pages/1', target: '_top', onmouseover: 'a' } }] }],
      }),
    );
    expect(out.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: '/pages/1' } }] }] });
  });

  it.each([
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['java\tscript:alert(1)'],
    [' javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox'],
    ['//evil.example/x'],
    ['/\\evil.example'],
  ])('lehnt unsichere Link-Ziele ab: %s', (href) => {
    expect(() => sanitizeDoc(doc(p('x', [{ type: 'link', attrs: { href } }])))).toThrow(ContentError);
  });

  it.each([['javascript:alert(1)'], ['data:image/svg+xml;base64,PHN2Zz4='], ['http://example.de/a.png'], ['//evil/x.png']])(
    'lehnt unsichere Bildquellen ab: %s',
    (src) => {
      expect(() => sanitizeDoc(doc({ type: 'image', attrs: { src } }))).toThrow(ContentError);
    },
  );

  it.each([['iframe'], ['script'], ['html'], ['__proto__'], ['constructor']])('lehnt unbekannte Knoten ab: %s', (type) => {
    expect(() => sanitizeDoc(doc({ type }))).toThrow(ContentError);
  });

  it('lehnt unbekannte Marks, falsche Überschriften und zu tiefe Dokumente ab', () => {
    expect(() => sanitizeDoc(doc(p('x', [{ type: 'textStyle', attrs: { color: 'red' } }])))).toThrow(ContentError);
    expect(() => sanitizeDoc(doc({ type: 'heading', attrs: { level: 6 } }))).toThrow(ContentError);
    let deep: DocNode = p('tief');
    for (let i = 0; i < 50; i++) deep = { type: 'blockquote', content: [deep] };
    expect(() => sanitizeDoc(doc(deep))).toThrow('zu tief');
    expect(() => sanitizeDoc({ type: 'paragraph' })).toThrow(ContentError);
    expect(() => sanitizeDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: '' }] }))).toThrow(ContentError);
  });

  it('übernimmt gezogene Bildgrößen gerundet und verwirft ungültige', () => {
    const image = (attrs: Record<string, unknown>) =>
      sanitizeDoc(doc({ type: 'image', attrs: { src: '/api/v1/attachments/1', ...attrs } })).content?.[0].attrs;
    expect(image({ width: 320.4, height: 180.6 })).toEqual({ src: '/api/v1/attachments/1', width: 320, height: 181 });
    expect(image({ width: '100%', height: 'calc(1px)' })).toEqual({ src: '/api/v1/attachments/1' });
    expect(image({ width: 5, height: 99_999 })).toEqual({ src: '/api/v1/attachments/1' });
    expect(image({ width: Number.NaN, height: null })).toEqual({ src: '/api/v1/attachments/1' });
    expect(image({ width: 200, style: 'width: 9999px' })).toEqual({ src: '/api/v1/attachments/1', width: 200 });
  });

  it('übernimmt gezogene Spaltenbreiten und verwirft ungültige', () => {
    const cell = (attrs: Record<string, unknown>) =>
      sanitizeDoc(doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs, content: [p('A')] }] }] }))
        .content?.[0].content?.[0].content?.[0].attrs;
    expect(cell({ colspan: 1, colwidth: [150.6] })).toEqual({ colspan: 1, rowspan: 1, colwidth: [151] });
    // Zusammengeführte Zellen: je Spalte ein Wert, 0 = Breite nicht gesetzt, zu schmale Spalten werden angehoben
    expect(cell({ colspan: 3, colwidth: [200, 0, 10] })).toEqual({ colspan: 3, rowspan: 1, colwidth: [200, 0, 40] });
    expect(cell({ colspan: 2, colwidth: [200] })).toEqual({ colspan: 2, rowspan: 1 });
    expect(cell({ colwidth: [0] })).toEqual({ colspan: 1, rowspan: 1 });
    expect(cell({ colwidth: ['100px'] })).toEqual({ colspan: 1, rowspan: 1 });
    expect(cell({ colwidth: [-5] })).toEqual({ colspan: 1, rowspan: 1 });
    expect(cell({ colwidth: [99_999] })).toEqual({ colspan: 1, rowspan: 1 });
    expect(cell({ colwidth: 'x' })).toEqual({ colspan: 1, rowspan: 1 });
  });

  it('ergänzt einen leeren Absatz für leere Dokumente', () => {
    expect(sanitizeDoc({ type: 'doc' })).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('Spaltenbreiten für die Ansicht', () => {
  const row = (...cells: Record<string, unknown>[]): DocNode => ({ type: 'tableRow', content: cells.map((attrs) => ({ type: 'tableCell', attrs })) });
  const table = (...rows: DocNode[]): DocNode => ({ type: 'table', content: rows });

  it('setzt eine feste Breite, wenn alle Spalten gezogen wurden', () => {
    expect(tableLayout(table(row({ colwidth: [120] }, { colspan: 2, colwidth: [200, 30] })))).toEqual({ columns: [120, 200, 40], width: 360 });
  });

  it('rechnet automatische Spalten als Mindestbreite', () => {
    expect(tableLayout(table(row({ colwidth: [150] }, {}), row({ colwidth: [999] }, {})))).toEqual({ columns: [150, null], minWidth: 190 });
    expect(tableLayout(table(row({}, { colspan: 2, colwidth: [0, 80] })))).toEqual({ columns: [null, null, 80], minWidth: 160 });
  });

  it('kommt mit leeren Tabellen zurecht', () => {
    expect(tableLayout(table())).toEqual({ columns: [] });
  });
});

describe('Textzeilen für Vergleich und Suche', () => {
  it('macht aus Blöcken lesbare Zeilen', () => {
    const lines = docToLines(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Abschnitt' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('eins')] }, { type: 'listItem', content: [p('zwei')] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('A')] }, { type: 'tableCell', content: [p('B')] }] }] },
        { type: 'callout', attrs: { variant: 'info' }, content: [p('Hinweis')] },
      ),
    );
    expect(lines).toEqual(['## Abschnitt', '• eins', '• zwei', '| A | B |', '[info] Hinweis']);
    expect(docToText(doc(p('a'), { type: 'paragraph' }, p('b')))).toBe('a\nb');
  });
});

describe('Zeichnungen (draw.io)', () => {
  const id = '3f0c8a6e-1b2d-4c5e-8f90-a1b2c3d4e5f6';

  it('behält Anhang, Fassung, Größe und Beschriftungen und verwirft den Rest', () => {
    const out = sanitizeDoc(
      doc({
        type: 'drawing',
        attrs: { attachmentId: id.toUpperCase(), version: 3, title: 'Netz', width: 640.4, height: 99_999, text: 'Router\nSwitch', src: 'javascript:x', onload: 'x' },
      }),
    );
    expect(out.content?.[0]).toEqual({ type: 'drawing', attrs: { attachmentId: id, version: 3, title: 'Netz', width: 640, text: 'Router\nSwitch' } });
    expect(drawingSrc(out.content?.[0].attrs)).toBe(`/api/v1/attachments/${id}/versions/3?inline=1`);
  });

  it.each([
    [{ attachmentId: '../../admin', version: 1 }],
    [{ attachmentId: id, version: 0 }],
    [{ attachmentId: id, version: '2' }],
    [{ version: 1 }],
  ])('lehnt ungültige Verweise ab: %j', (attrs) => {
    expect(() => sanitizeDoc(doc({ type: 'drawing', attrs }))).toThrow(ContentError);
    expect(drawingSrc(attrs as Record<string, unknown>)).toBeNull();
  });

  it('kürzt lange Beschriftungen und nimmt sie in Suche und Vergleich auf', () => {
    const out = sanitizeDoc(doc({ type: 'drawing', attrs: { attachmentId: id, version: 1, text: 'x'.repeat(20_000) } }));
    expect((out.content?.[0].attrs?.text as string).length).toBe(10_000);
    const lines = docToLines(doc({ type: 'drawing', attrs: { attachmentId: id, version: 1, title: 'LAN', text: 'Router A\nFirewall' } }));
    expect(lines).toEqual(['[Zeichnung: LAN] Router A Firewall']);
  });
});
