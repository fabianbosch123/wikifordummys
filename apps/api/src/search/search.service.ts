import { Injectable } from '@nestjs/common';
import { ATTACHMENT_HITS_MAX, SEARCH_PAGE_SIZE, type AttachmentHitDto, type SearchHitDto, type SearchResultDto } from '@wiki/shared';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { pathIds, PermissionService } from '../spaces/permission.service';

// Markierungen für Treffer im Textausschnitt; sie werden vorher aus dem Text entfernt
const START = '\u0002';
const STOP = '\u0003';
const HEADLINE_OPTIONS = `StartSel=${START}, StopSel=${STOP}, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "`;

/**
 * Aufräumen des Seitentexts für die Ausschnitte (nicht für den Index): Platzhalter für Bilder und Zeichnungen,
 * Trennlinien und Überschriftenzeichen fallen weg, Tabellenzellen werden mit „·“ getrennt, leere Zellen verschwinden.
 * Als Parameter übergeben, damit sie nicht in der Abfrage stehen.
 */
const SNIPPET_PLACEHOLDER = String.raw`\[(Bild|Zeichnung): [^\]\n]*\]`;
const SNIPPET_LINE_MARKUP = String.raw`^(-{3,}[ \t]*$|#{1,6} )`;
const SNIPPET_TABLE_CELLS = String.raw`\s*(\|\s*)+`;

/** Wörter der Eingabe (nur Buchstaben und Ziffern), höchstens 8 zu je 60 Zeichen */
function words(input: string): string[] {
  return (input.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => Array.from(w).slice(0, 60).join(''));
}

/**
 * Baut aus der Eingabe eine tsquery: jedes Wort als Präfix (Druck findet Drucker), alle Wörter müssen vorkommen.
 * Es bleiben nur Buchstaben und Ziffern übrig, Operatoren der Abfragesprache können also nicht eingeschleust werden.
 */
export function toTsQuery(input: string): string | null {
  const list = words(input);
  return list.length ? list.map((w) => `${w}:*`).join(' & ') : null;
}

/** Muster für Dateinamen: jedes Wort muss irgendwo im Namen vorkommen (ILIKE ALL); % und _ gibt es in Wörtern nicht */
export function filenamePatterns(input: string): string[] {
  return words(input).map((w) => `%${w}%`);
}

/** Zerlegt den Ausschnitt aus ts_headline in Text und Treffer */
export function splitSnippet(raw: string): SearchHitDto['snippet'] {
  const parts: SearchHitDto['snippet'] = [];
  for (const [i, segment] of raw.split(START).entries()) {
    if (i === 0) {
      if (segment) parts.push({ text: segment, match: false });
      continue;
    }
    const [hit, rest = ''] = segment.split(STOP);
    if (hit) parts.push({ text: hit, match: true });
    if (rest) parts.push({ text: rest, match: false });
  }
  return tidySnippet(parts);
}

/** Leerraum zusammenfassen, doppelte Trenner „·“ und Trenner am Anfang und Ende entfernen */
export function tidySnippet(parts: SearchHitDto['snippet']): SearchHitDto['snippet'] {
  const out = parts.map((p) => ({ ...p, text: p.text.replace(/\s+/g, ' ').replace(/( ?· ?){2,}/g, ' · ') }));
  if (out.length && !out[0].match) out[0].text = out[0].text.replace(/^[\s·]+/, '');
  const last = out.at(-1);
  if (last && !last.match) last.text = last.text.replace(/[\s·]+$/, '');
  return out.filter((p) => p.text);
}

interface Row {
  id: string;
  title: string;
  path: string;
  updated_at: Date;
  space_key: string;
  space_name: string;
  snippet: string;
}

interface AttachmentRow {
  id: string;
  filename: string;
  updated_at: Date;
  page_id: string;
  page_title: string;
  path: string;
  space_key: string;
  space_name: string;
}

/**
 * Volltextsuche über Titel und Inhalt mit PostgreSQL (deutsches Wörterbuch, GIN-Index auf search_vector).
 * Gefiltert wird mit denselben Rechten wie überall (S8): nur Spaces mit Rolle, keine gelöschten Seiten
 * und keine Seiten, deren Ansehen-Einschränkung (auch geerbt) der Benutzer nicht erfüllt.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async search(user: AuthUser, q: string, opts: { spaceKey?: string; offset?: number } = {}): Promise<SearchResultDto> {
    let roles = await this.permissions.roles(user);
    if (opts.spaceKey) {
      const { space, role } = await this.permissions.requireSpace(user, opts.spaceKey, 'view');
      roles = new Map([[space.id, role]]);
    }
    const query = toTsQuery(q);
    if (!query || roles.size === 0) return { results: [], hasMore: false, attachments: [] };

    const spaceIds = [...roles.keys()];
    const hidden = [...(await this.permissions.hiddenPageIds(user, spaceIds.filter((id) => roles.get(id) !== 'admin')))];
    const offset = opts.offset ?? 0;

    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT p.id, p.title, p.path, p.updated_at, s.key AS space_key, s.name AS space_name,
             ts_headline('german',
               regexp_replace(
                 regexp_replace(
                   regexp_replace(translate(p.content_text, ${START + STOP}, ''), ${SNIPPET_PLACEHOLDER}, ' ', 'g'),
                   ${SNIPPET_LINE_MARKUP}, '', 'gn'),
                 ${SNIPPET_TABLE_CELLS}, ' · ', 'g'),
               q, ${HEADLINE_OPTIONS}) AS snippet
      FROM pages p
      JOIN spaces s ON s.id = p.space_id
      CROSS JOIN to_tsquery('german', ${query}) q
      WHERE p.deleted_at IS NULL
        AND p.space_id = ANY(${spaceIds}::uuid[])
        AND p.search_vector @@ q
        AND NOT EXISTS (SELECT 1 FROM unnest(${hidden}::uuid[]) h WHERE p.path LIKE '%/' || h::text || '/%')
      ORDER BY ts_rank_cd(p.search_vector, q) DESC, p.updated_at DESC, p.id
      LIMIT ${SEARCH_PAGE_SIZE + 1}::int OFFSET ${offset}::int`;

    // Anhänge nur zur ersten Trefferseite; gleiche Rechte wie bei den Seiten, an denen sie hängen
    const attachmentRows =
      offset === 0
        ? await this.prisma.$queryRaw<AttachmentRow[]>`
            SELECT a.id, a.filename, a.updated_at, p.id AS page_id, p.title AS page_title, p.path,
                   s.key AS space_key, s.name AS space_name
            FROM attachments a
            JOIN pages p ON p.id = a.page_id
            JOIN spaces s ON s.id = p.space_id
            WHERE p.deleted_at IS NULL
              AND p.space_id = ANY(${spaceIds}::uuid[])
              AND a.filename ILIKE ALL(${filenamePatterns(q)}::text[])
              AND NOT EXISTS (SELECT 1 FROM unnest(${hidden}::uuid[]) h WHERE p.path LIKE '%/' || h::text || '/%')
            ORDER BY a.updated_at DESC, a.id
            LIMIT ${ATTACHMENT_HITS_MAX}::int`
        : [];

    const pages = rows.slice(0, SEARCH_PAGE_SIZE);
    const titleOf = await this.ancestorTitles([...pages.map((r) => r.path), ...attachmentRows.map((r) => r.path)]);
    const pathOf = (path: string) => pathIds(path).slice(0, -1).flatMap((id) => titleOf.get(id) ?? []);

    return {
      results: pages.map((r) => ({
        id: r.id,
        title: r.title,
        spaceKey: r.space_key,
        spaceName: r.space_name,
        path: pathOf(r.path),
        snippet: splitSnippet(r.snippet),
        updatedAt: r.updated_at.toISOString(),
      })),
      hasMore: rows.length > SEARCH_PAGE_SIZE,
      attachments: attachmentRows.map(
        (a): AttachmentHitDto => ({
          id: a.id,
          filename: a.filename,
          url: `/api/v1/attachments/${a.id}`,
          pageId: a.page_id,
          pageTitle: a.page_title,
          path: pathOf(a.path),
          spaceKey: a.space_key,
          spaceName: a.space_name,
          updatedAt: a.updated_at.toISOString(),
        }),
      ),
    };
  }

  /**
   * Titel aller Vorfahren der Pfade. Wer eine Seite sehen darf, darf auch ihre Vorfahren sehen
   * (Einschränkungen werden vererbt), die Titel verraten also nichts Neues.
   */
  private async ancestorTitles(paths: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(paths.flatMap((p) => pathIds(p).slice(0, -1)))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.page.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
    return new Map(rows.map((r) => [r.id, r.title]));
  }
}
