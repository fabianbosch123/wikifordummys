import { crc32 } from 'node:zlib';
import type { NewOfficeKind } from '@wiki/shared';

/**
 * Leere Office-Dokumente zum Anlegen aus dem Editor (Word, Excel, PowerPoint).
 * Erzeugt werden die kleinsten OOXML-Pakete, die Word, Excel, PowerPoint, LibreOffice und der
 * Office-Editor ohne Reparatur öffnen: Teile als XML, verpackt in ein ZIP ohne Kompression.
 * Alles ist fest vorgegeben (auch die Zeitstempel), dieselbe Vorlage ergibt also dieselben Bytes.
 */
export { NEW_OFFICE_KINDS, type NewOfficeKind } from '@wiki/shared';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c]};`);

function contentTypes(overrides: Record<string, string>): string {
  return (
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    Object.entries(overrides)
      .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
      .join('') +
    '</Types>'
  );
}

/** Beziehungen eines Teils: [Typ (kurz für officeDocument-Beziehungen, sonst die volle Adresse), Ziel] */
function rels(entries: [string, string][]): string {
  const full = (type: string) => (type.startsWith('http') ? type : `${REL_TYPE}/${type}`);
  return (
    `${XML}<Relationships xmlns="${NS_REL}">` +
    entries.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${full(type)}" Target="${target}"/>`).join('') +
    '</Relationships>'
  );
}

function coreProps(title: string): string {
  return (
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(title)}</dc:title><dc:language>de-DE</dc:language></cp:coreProperties>`
  );
}

const CORE_TYPE = 'application/vnd.openxmlformats-package.core-properties+xml';
const rootRels = (main: string) =>
  rels([
    ['officeDocument', main],
    ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
  ]);

function docx(title: string): Record<string, string> {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return {
    '[Content_Types].xml': contentTypes({
      '/word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      '/word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
      '/docProps/core.xml': CORE_TYPE,
    }),
    '_rels/.rels': rootRels('word/document.xml'),
    'word/_rels/document.xml.rels': rels([['styles', 'styles.xml']]),
    'word/document.xml':
      `${XML}<w:document xmlns:w="${W}" xmlns:r="${NS_R}"><w:body><w:p/>` +
      // A4 hoch, 2,5 cm Rand
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>',
    'word/styles.xml':
      `${XML}<w:styles xmlns:w="${W}"><w:docDefaults>` +
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
      '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-DE" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '</w:styles>',
    'docProps/core.xml': coreProps(title),
  };
}

function xlsx(title: string): Record<string, string> {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return {
    '[Content_Types].xml': contentTypes({
      '/xl/workbook.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      '/xl/worksheets/sheet1.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
      '/xl/styles.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
      '/docProps/core.xml': CORE_TYPE,
    }),
    '_rels/.rels': rootRels('xl/workbook.xml'),
    'xl/_rels/workbook.xml.rels': rels([
      ['worksheet', 'worksheets/sheet1.xml'],
      ['styles', 'styles.xml'],
    ]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${S}" xmlns:r="${NS_R}"><sheets><sheet name="Tabelle1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="${S}" xmlns:r="${NS_R}"><sheetData/></worksheet>`,
    // Das kleinste Stylesheet, das Excel ohne Reparatur annimmt (zwei Pflicht-Füllungen)
    'xl/styles.xml':
      `${XML}<styleSheet xmlns="${S}">` +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
    'docProps/core.xml': coreProps(title),
  };
}

/** Platzhalter einer Folie bzw. eines Layouts; mit Position nur im Master */
function placeholder(id: number, name: string, type: string, xfrm?: [number, number, number, number]): string {
  const sp = xfrm ? `<a:xfrm><a:off x="${xfrm[0]}" y="${xfrm[1]}"/><a:ext cx="${xfrm[2]}" cy="${xfrm[3]}"/></a:xfrm>` : '';
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr>${sp}</p:spPr>` +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="de-DE"/></a:p></p:txBody></p:sp>'
  );
}

function shapeTree(shapes: string): string {
  return (
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    `${shapes}</p:spTree></p:cSld>`
  );
}

const solid = (color: string) => `<a:solidFill><a:schemeClr val="${color}"/></a:solidFill>`;

/** Design mit allen Pflichtteilen (Farben, Schriften, je drei Füllungen, Linien, Effekte, Hintergründe) */
function theme(): string {
  const colors: [string, string][] = [
    ['dk1', '<a:sysClr val="windowText" lastClr="000000"/>'],
    ['lt1', '<a:sysClr val="window" lastClr="FFFFFF"/>'],
    ['dk2', '<a:srgbClr val="44546A"/>'],
    ['lt2', '<a:srgbClr val="E7E6E6"/>'],
    ['accent1', '<a:srgbClr val="4472C4"/>'],
    ['accent2', '<a:srgbClr val="ED7D31"/>'],
    ['accent3', '<a:srgbClr val="A5A5A5"/>'],
    ['accent4', '<a:srgbClr val="FFC000"/>'],
    ['accent5', '<a:srgbClr val="5B9BD5"/>'],
    ['accent6', '<a:srgbClr val="70AD47"/>'],
    ['hlink', '<a:srgbClr val="0563C1"/>'],
    ['folHlink', '<a:srgbClr val="954F72"/>'],
  ];
  const fonts = (face: string) => `<a:latin typeface="${face}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const fill = solid('phClr');
  const line = (w: number) => `<a:ln w="${w}">${fill}</a:ln>`;
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>';
  return (
    `${XML}<a:theme xmlns:a="${NS_A}" name="Wiki"><a:themeElements>` +
    `<a:clrScheme name="Wiki">${colors.map(([n, c]) => `<a:${n}>${c}</a:${n}>`).join('')}</a:clrScheme>` +
    `<a:fontScheme name="Wiki"><a:majorFont>${fonts('Calibri Light')}</a:majorFont><a:minorFont>${fonts('Calibri')}</a:minorFont></a:fontScheme>` +
    '<a:fmtScheme name="Wiki">' +
    `<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
  );
}

function pptx(title: string): Record<string, string> {
  const ns = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
  const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
  // 16:9 (33,867 cm × 19,05 cm)
  const [cx, cy] = [12192000, 6858000];
  const textStyle = (size: number) => `<a:lvl1pPr><a:defRPr sz="${size}">${solid('tx1')}<a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;
  return {
    '[Content_Types].xml': contentTypes({
      '/ppt/presentation.xml': `${PML}.presentation.main+xml`,
      '/ppt/slideMasters/slideMaster1.xml': `${PML}.slideMaster+xml`,
      '/ppt/slideLayouts/slideLayout1.xml': `${PML}.slideLayout+xml`,
      '/ppt/slides/slide1.xml': `${PML}.slide+xml`,
      '/ppt/theme/theme1.xml': 'application/vnd.openxmlformats-officedocument.theme+xml',
      '/docProps/core.xml': CORE_TYPE,
    }),
    '_rels/.rels': rootRels('ppt/presentation.xml'),
    'ppt/_rels/presentation.xml.rels': rels([
      ['slideMaster', 'slideMasters/slideMaster1.xml'],
      ['slide', 'slides/slide1.xml'],
      ['theme', 'theme/theme1.xml'],
    ]),
    'ppt/presentation.xml':
      `${XML}<p:presentation ${ns}>` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
      `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${cy}" cy="${cx}"/></p:presentation>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      ['slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['theme', '../theme/theme1.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml':
      `${XML}<p:sldMaster ${ns}>` +
      shapeTree(placeholder(2, 'Titel', 'title', [838200, 365125, 10515600, 1325563]) + placeholder(3, 'Text', 'body', [838200, 1825625, 10515600, 4351338])).replace(
        '<p:cSld>',
        `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>`,
      ) +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      `<p:txStyles><p:titleStyle>${textStyle(4400).replace('+mn-lt', '+mj-lt')}</p:titleStyle>` +
      `<p:bodyStyle>${textStyle(2800)}</p:bodyStyle><p:otherStyle>${textStyle(1800)}</p:otherStyle></p:txStyles>` +
      '</p:sldMaster>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml':
      `${XML}<p:sldLayout ${ns} type="obj" preserve="1">` +
      shapeTree(placeholder(2, 'Titel', 'title') + placeholder(3, 'Text', 'body')).replace('<p:cSld>', '<p:cSld name="Titel und Inhalt">') +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
    'ppt/slides/_rels/slide1.xml.rels': rels([['slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/slides/slide1.xml':
      `${XML}<p:sld ${ns}>${shapeTree(placeholder(2, 'Titel', 'title') + placeholder(3, 'Text', 'body'))}` +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
    'ppt/theme/theme1.xml': theme(),
    'docProps/core.xml': coreProps(title),
  };
}

/** ZIP ohne Kompression (Verfahren 0), Dateinamen in UTF-8, Zeitstempel 1.1.1980 */
export function zip(files: Record<string, string | Buffer>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // benötigte Version 2.0
    header.writeUInt16LE(0x0800, 6); // Dateiname in UTF-8
    header.writeUInt16LE(0, 8); // gespeichert, nicht komprimiert
    header.writeUInt16LE(0, 10); // Uhrzeit 00:00
    header.writeUInt16LE(0x21, 12); // Datum 1.1.1980
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // erstellt mit Version 2.0
    header.copy(entry, 6, 4, 30); // Version bis Länge des Namens wie im lokalen Kopf
    // Kommentar, Datenträger, interne und externe Attribute: 0
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(local.length / 3, 8);
  end.writeUInt16LE(local.length / 3, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const BUILDERS: Record<NewOfficeKind, (title: string) => Record<string, string>> = { docx, xlsx, pptx };

/** Leeres Dokument der gewünschten Art; der Titel landet in den Dokumenteigenschaften */
export function emptyOfficeFile(kind: NewOfficeKind, title: string): Buffer {
  return zip(BUILDERS[kind](title));
}
