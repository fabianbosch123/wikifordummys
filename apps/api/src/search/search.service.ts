import { Injectable } from '@nestjs/common';
import { SEARCH_PAGE_SIZE, type SearchHitDto, type SearchResultDto } from '@wiki/shared';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../spaces/permission.service';

// Markierungen für Treffer im Textausschnitt; sie werden vorher aus dem Text entfernt
const START = '\u0002';
const STOP = '\u0003';
const HEADLINE_OPTIONS = `StartSel=${START}, StopSel=${STOP}, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "`;

/**
 * Baut aus der Eingabe eine tsquery: jedes Wort als Präfix (Druck findet Drucker), alle Wörter müssen vorkommen.
 * Es bleiben nur Buchstaben und Ziffern übrig, Operatoren der Abfragesprache können also nicht eingeschleust werden.
 */
export function toTsQuery(input: string): string | null {
  const words = (input.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => Array.from(w).slice(0, 60).join(''));
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
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
  return parts;
}

interface Row {
  id: string;
  title: string;
  updated_at: Date;
  space_key: string;
  space_name: string;
  snippet: string;
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
    if (!query || roles.size === 0) return { results: [], hasMore: false };

    const spaceIds = [...roles.keys()];
    const hidden = [...(await this.permissions.hiddenPageIds(user, spaceIds.filter((id) => roles.get(id) !== 'admin')))];
    const offset = opts.offset ?? 0;

    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT p.id, p.title, p.updated_at, s.key AS space_key, s.name AS space_name,
             ts_headline('german', translate(p.content_text, ${START + STOP}, ''), q, ${HEADLINE_OPTIONS}) AS snippet
      FROM pages p
      JOIN spaces s ON s.id = p.space_id
      CROSS JOIN to_tsquery('german', ${query}) q
      WHERE p.deleted_at IS NULL
        AND p.space_id = ANY(${spaceIds}::uuid[])
        AND p.search_vector @@ q
        AND NOT EXISTS (SELECT 1 FROM unnest(${hidden}::uuid[]) h WHERE p.path LIKE '%/' || h::text || '/%')
      ORDER BY ts_rank_cd(p.search_vector, q) DESC, p.updated_at DESC, p.id
      LIMIT ${SEARCH_PAGE_SIZE + 1}::int OFFSET ${offset}::int`;

    return {
      results: rows.slice(0, SEARCH_PAGE_SIZE).map((r) => ({
        id: r.id,
        title: r.title,
        spaceKey: r.space_key,
        spaceName: r.space_name,
        snippet: splitSnippet(r.snippet),
        updatedAt: r.updated_at.toISOString(),
      })),
      hasMore: rows.length > SEARCH_PAGE_SIZE,
    };
  }
}
