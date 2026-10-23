import { COLUMN_WIDTH, IMAGE_SIZE, isSafeImageSrc, isSafeLinkHref, tableLayout, type DocMark, type DocNode } from '@wiki/shared';
import { Fragment, ReactNode } from 'react';

/**
 * Rendert TipTap-JSON als React-Elemente (S6). Nur erlaubte Knoten werden dargestellt,
 * Text ist immer Text; es gibt kein innerHTML. URLs werden zusätzlich zur Prüfung in der API
 * hier noch einmal kontrolliert.
 */
export function RichText({ doc }: { doc: DocNode }) {
  return <div className="rich">{renderChildren(doc)}</div>;
}

const CALLOUT_LABELS: Record<string, string> = { info: 'Info', warning: 'Warnung', success: 'Erledigt', note: 'Notiz' };

function renderChildren(node: DocNode): ReactNode[] {
  return (node.content ?? []).map((child, i) => renderNode(child, i));
}

function renderMarks(text: string, marks: DocMark[] = []): ReactNode {
  return marks.reduce<ReactNode>((inner, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{inner}</strong>;
      case 'italic':
        return <em>{inner}</em>;
      case 'strike':
        return <s>{inner}</s>;
      case 'underline':
        return <u>{inner}</u>;
      case 'code':
        return <code>{inner}</code>;
      case 'link': {
        const href = mark.attrs?.href;
        if (!isSafeLinkHref(href)) return inner;
        const external = /^https?:/i.test(href);
        return (
          <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}>
            {inner}
          </a>
        );
      }
      default:
        return inner;
    }
  }, text);
}

function cellProps(node: DocNode) {
  const colSpan = Number(node.attrs?.colspan ?? 1);
  const rowSpan = Number(node.attrs?.rowspan ?? 1);
  return { colSpan: colSpan > 1 ? colSpan : undefined, rowSpan: rowSpan > 1 ? rowSpan : undefined };
}

/** Gespeicherte Bildgröße (Pixel); die Seitenbreite begrenzt sie weiterhin per CSS */
function sizeAttr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= IMAGE_SIZE.min && value <= IMAGE_SIZE.max ? value : undefined;
}

function renderTable(node: DocNode, key: number): ReactNode {
  const layout = tableLayout(node);
  const style = layout.width ? { width: layout.width } : layout.minWidth ? { minWidth: layout.minWidth } : undefined;
  return (
    <div key={key} className="table-wrap">
      <table style={style}>
        {layout.columns.length > 0 && (
          <colgroup>
            {layout.columns.map((w, i) => (
              <col key={i} style={w ? { width: w } : { minWidth: COLUMN_WIDTH.min }} />
            ))}
          </colgroup>
        )}
        <tbody>{renderChildren(node)}</tbody>
      </table>
    </div>
  );
}

function renderNode(node: DocNode, key: number): ReactNode {
  const children = () => renderChildren(node);
  switch (node.type) {
    case 'text':
      return <Fragment key={key}>{renderMarks(node.text ?? '', node.marks)}</Fragment>;
    case 'paragraph':
      return <p key={key}>{children()}</p>;
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 4);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      return <Tag key={key}>{children()}</Tag>;
    }
    case 'bulletList':
      return <ul key={key}>{children()}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={Number(node.attrs?.start ?? 1)}>
          {children()}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{children()}</li>;
    case 'blockquote':
      return <blockquote key={key}>{children()}</blockquote>;
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : undefined;
      return (
        <pre key={key} data-language={language}>
          <code>{(node.content ?? []).map((c) => c.text ?? '').join('')}</code>
        </pre>
      );
    }
    case 'horizontalRule':
      return <hr key={key} />;
    case 'hardBreak':
      return <br key={key} />;
    case 'image': {
      const src = node.attrs?.src;
      if (!isSafeImageSrc(src)) return null;
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : undefined;
      return (
        <img
          key={key}
          src={src}
          alt={alt}
          title={title}
          width={sizeAttr(node.attrs?.width)}
          height={sizeAttr(node.attrs?.height)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      );
    }
    case 'table':
      return renderTable(node, key);
    case 'tableRow':
      return <tr key={key}>{children()}</tr>;
    case 'tableHeader':
      return (
        <th key={key} {...cellProps(node)}>
          {children()}
        </th>
      );
    case 'tableCell':
      return (
        <td key={key} {...cellProps(node)}>
          {children()}
        </td>
      );
    case 'callout': {
      const variant = String(node.attrs?.variant ?? 'info');
      const label = CALLOUT_LABELS[variant] ?? CALLOUT_LABELS.info;
      return (
        <div key={key} className={`callout callout-${CALLOUT_LABELS[variant] ? variant : 'info'}`} role="note" aria-label={label}>
          {children()}
        </div>
      );
    }
    default:
      // Unbekannte Knoten werden nicht dargestellt
      return null;
  }
}
