import { deflateRawSync } from 'node:zlib';
import { DrawingError, embedXml, extractXml, labelText, parseDrawio, readableXml, renderDrawing } from './drawio';

const MODEL = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="g" value="Rechenzentrum" style="swimlane;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell>
<mxCell id="a" value="Firewall &lt;b&gt;1&lt;/b&gt;" style="rhombus;html=1;" vertex="1" parent="g"><mxGeometry x="20" y="40" width="80" height="80" as="geometry"/></mxCell>
<mxCell id="b" value="Speicher" style="shape=cylinder3;" vertex="1" parent="g"><mxGeometry x="180" y="40" width="60" height="80" as="geometry"/></mxCell>
<mxCell id="e" style="endArrow=none;dashed=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="140" y="150"/></Array></mxGeometry></mxCell>
</root></mxGraphModel>`;

describe('draw.io-Zeichnungen für den MCP-Server', () => {
  it('rendert ein PNG mit eingebettetem XML, das draw.io wieder liest', () => {
    const d = renderDrawing(MODEL);
    expect(d.png.subarray(1, 4).toString()).toBe('PNG');
    // Kinder eines Containers liegen relativ zu ihm; Ausmaß = Container + Rand
    expect(d.width).toBe(320);
    expect(d.height).toBe(220);
    expect(d.text).toBe('Rechenzentrum\nFirewall 1\nSpeicher');
    const xml = extractXml(d.png)!;
    expect(xml).toMatch(/^<mxfile host="wikifordummys"><diagram name="Seite-1" id="seite-1"><mxGraphModel>/);
    expect(parseDrawio(xml)[0].model).toEqual(parseDrawio(MODEL)[0].model);
  });

  it('liest komprimierte Diagramme aus draw.io Desktop', () => {
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(MODEL))).toString('base64');
    const file = `<mxfile><diagram name="Netz" id="x1">${compressed}</diagram></mxfile>`;
    const d = renderDrawing(file);
    expect(d.text).toContain('Speicher');
    expect(readableXml(d.png)).toContain('<diagram name="Netz" id="x1"><mxGraphModel>');
  });

  it('bettet ein und liest aus wie draw.io (tEXt mxfile, URI-kodiert)', () => {
    const png = renderDrawing(MODEL).png;
    const again = embedXml(png, '<mxfile>ä</mxfile>');
    // Der alte Block wird ersetzt, nicht ergänzt
    expect(extractXml(again)).toBe('<mxfile>ä</mxfile>');
    expect(again.toString('latin1').split('mxfile\0').length).toBe(2);
  });

  it('weist kaputtes, leeres und gefährliches XML ab', () => {
    expect(() => renderDrawing('<mxGraphModel><root>')).toThrow(DrawingError);
    expect(() => renderDrawing('<foo/>')).toThrow(/mxfile/);
    expect(() => renderDrawing('<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>')).toThrow(/leer/);
    expect(() => renderDrawing('<!DOCTYPE a [<!ENTITY x "y">]><mxGraphModel/>')).toThrow(/DOCTYPE/);
    expect(() => renderDrawing(`<mxGraphModel><root><mxCell id="a" vertex="1"><mxGeometry x="0" y="0" width="9000" height="10" as="geometry"/></mxCell></root></mxGraphModel>`)).toThrow(/zu groß/);
  });

  it('macht aus HTML-Beschriftungen Text', () => {
    expect(labelText('Zeile 1<br>Zeile&nbsp;2 &amp; <i>mehr</i>&#33;', true)).toBe('Zeile 1\nZeile 2 & mehr!');
    expect(labelText('<b>roh</b>', false)).toBe('<b>roh</b>');
  });
});
