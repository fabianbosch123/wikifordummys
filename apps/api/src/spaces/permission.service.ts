import { Injectable } from '@nestjs/common';
import type { Page, PageRestriction, RestrictionType, Space } from '@prisma/client';
import { SPACE_KEY_PATTERN, type SpaceRole } from '@wiki/shared';
import { Errors } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';

/** view = lesen; edit = Seiten anlegen und ändern; admin = Space verwalten, Seiten löschen und wiederherstellen */
export type SpaceNeed = 'view' | 'edit' | 'admin';

export interface SpaceAccess {
  space: Space;
  role: SpaceRole;
  /** Seiten dürfen angelegt und geändert werden (Rolle reicht und Space ist nicht archiviert) */
  canEdit: boolean;
}

export interface PageAccess extends SpaceAccess {
  page: Page;
  /** Für die Seite gelten eigene oder geerbte Einschränkungen (unabhängig davon, ob der Benutzer sie erfüllt) */
  restricted: { view: boolean; edit: boolean };
}

type Subject = Pick<PageRestriction, 'userId' | 'groupId'>;

const RANK: Record<SpaceRole, number> = { viewer: 0, editor: 1, admin: 2 };
const NEEDED: Record<SpaceNeed, SpaceRole> = { view: 'viewer', edit: 'editor', admin: 'admin' };

/** Seiten-IDs aus dem materialisierten Pfad /a/b/c/ */
export const pathIds = (path: string) => path.split('/').filter(Boolean);

function byPage<T extends { pageId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(row.pageId, [...(map.get(row.pageId) ?? []), row]);
  return map;
}

export function highestRole(roles: SpaceRole[]): SpaceRole | null {
  return roles.reduce<SpaceRole | null>((best, r) => (!best || RANK[r] > RANK[best] ? r : best), null);
}

/**
 * Die eine Stelle für Rechte auf Spaces und Seiten (S8). Jeder Zugriff der Spaces-, Seiten-,
 * Anhang- und Such-Routen läuft hierüber. Auswertung wie im Architekturkonzept:
 *
 * 1. Systemadministratoren sind in jedem Space Admin.
 * 2. Sonst gilt die höchste Space-Rolle aus dem Benutzer selbst und allen seinen Gruppen
 *    (alle-benutzer zählt für jedes aktive Konto). Ohne Rolle gibt es 404 statt 403,
 *    damit die Existenz verborgen bleibt.
 * 3. Seiteneinschränkungen gelten entlang des Pfads: jede Einschränkung der Seite und ihrer Vorfahren
 *    muss erfüllt sein, sie verengen nur. Wer eine Ansehen-Einschränkung nicht erfüllt, bekommt 404;
 *    eine Bearbeiten-Einschränkung nimmt nur das Bearbeiten. Space-Admins sind nicht eingeschränkt,
 *    damit keine Seite unerreichbar werden kann.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  matches(user: AuthUser, subject: Subject): boolean {
    return subject.userId === user.id || (subject.groupId !== null && user.groupIds.includes(subject.groupId));
  }

  async roleFor(user: AuthUser, spaceId: string): Promise<SpaceRole | null> {
    if (user.isAdmin) return 'admin';
    const rows = await this.prisma.spacePermission.findMany({
      where: { spaceId, OR: [{ userId: user.id }, { groupId: { in: user.groupIds } }] },
      select: { role: true },
    });
    return highestRole(rows.map((r) => r.role));
  }

  /** Rollen des Benutzers in allen Spaces, in denen er eine hat */
  async roles(user: AuthUser): Promise<Map<string, SpaceRole>> {
    if (user.isAdmin) {
      const spaces = await this.prisma.space.findMany({ select: { id: true } });
      return new Map(spaces.map((s) => [s.id, 'admin' as const]));
    }
    const rows = await this.prisma.spacePermission.findMany({
      where: { OR: [{ userId: user.id }, { groupId: { in: user.groupIds } }] },
      select: { spaceId: true, role: true },
    });
    const result = new Map<string, SpaceRole>();
    for (const { spaceId, role } of rows) {
      const current = result.get(spaceId);
      if (!current || RANK[role] > RANK[current]) result.set(spaceId, role);
    }
    return result;
  }

  access(space: Space, role: SpaceRole | null): SpaceAccess | null {
    if (!role) return null;
    return { space, role, canEdit: space.status === 'active' && RANK[role] >= RANK.editor };
  }

  /** Wirft 404 ohne Rolle, 403 bei zu niedriger Rolle und bei Änderungen in archivierten Spaces */
  check<T extends SpaceAccess>(access: T | null, need: SpaceNeed): T {
    if (!access) throw Errors.notFound();
    if (RANK[access.role] < RANK[NEEDED[need]]) throw Errors.forbidden();
    if (need === 'edit' && access.space.status !== 'active') throw Errors.spaceArchived();
    return access;
  }

  async requireSpace(user: AuthUser, rawKey: string, need: SpaceNeed): Promise<SpaceAccess> {
    const key = rawKey.toUpperCase();
    const space = SPACE_KEY_PATTERN.test(key) ? await this.prisma.space.findUnique({ where: { key } }) : null;
    return this.check(space ? this.access(space, await this.roleFor(user, space.id)) : null, need);
  }

  /**
   * Lädt eine Seite samt Space und prüft Space-Rolle und Seiteneinschränkungen.
   * Gelöschte Seiten gelten als nicht vorhanden, außer opts.deleted ist gesetzt.
   * canEdit im Ergebnis berücksichtigt die Bearbeiten-Einschränkungen.
   */
  async requirePage(user: AuthUser, pageId: string, need: SpaceNeed, opts: { deleted?: boolean } = {}): Promise<PageAccess> {
    const loaded = await this.prisma.page.findUnique({ where: { id: pageId }, include: { space: true } });
    if (!loaded || Boolean(loaded.deletedAt) !== Boolean(opts.deleted)) throw Errors.notFound();
    const { space, ...page } = loaded;
    const access = this.access(space, await this.roleFor(user, space.id));
    if (!access) throw Errors.notFound();

    const restrictions = await this.prisma.pageRestriction.findMany({ where: { pageId: { in: pathIds(page.path) } } });
    const satisfied = (type: RestrictionType) => {
      if (access.role === 'admin') return true;
      return [...byPage(restrictions.filter((r) => r.type === type)).values()].every((list) => list.some((r) => this.matches(user, r)));
    };
    // Wer die Seite nicht sehen darf, erfährt auch nicht, dass es sie gibt
    if (!satisfied('view')) throw Errors.notFound();

    const result: PageAccess = {
      ...access,
      canEdit: access.canEdit && satisfied('edit'),
      page,
      restricted: { view: restrictions.some((r) => r.type === 'view'), edit: restrictions.some((r) => r.type === 'edit') },
    };
    this.check(result, need);
    if (need === 'edit' && !result.canEdit) throw Errors.forbidden();
    return result;
  }

  /**
   * Seiten in den angegebenen Spaces, deren Ansehen-Einschränkung der Benutzer nicht erfüllt.
   * Eine Seite ist sichtbar, wenn keine Seite ihres Pfads in dieser Menge liegt.
   * Spaces, in denen der Benutzer Admin ist, gehören nicht in spaceIds.
   */
  async hiddenPageIds(user: AuthUser, spaceIds: string[]): Promise<Set<string>> {
    if (spaceIds.length === 0) return new Set();
    const rows = await this.prisma.pageRestriction.findMany({
      where: { type: 'view', page: { spaceId: { in: spaceIds } } },
      select: { pageId: true, userId: true, groupId: true },
    });
    const hidden = new Set<string>();
    for (const [pageId, list] of byPage(rows)) {
      if (!list.some((r) => this.matches(user, r))) hidden.add(pageId);
    }
    return hidden;
  }

  /** Prüffunktion für Seitenpfade eines Spaces: true = der Benutzer darf die Seite sehen */
  async visibility(user: AuthUser, access: SpaceAccess): Promise<(path: string) => boolean> {
    if (access.role === 'admin') return () => true;
    const hidden = await this.hiddenPageIds(user, [access.space.id]);
    return (path) => !pathIds(path).some((id) => hidden.has(id));
  }
}
