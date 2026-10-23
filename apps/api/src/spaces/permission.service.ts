import { Injectable } from '@nestjs/common';
import type { Page, Space } from '@prisma/client';
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

const RANK: Record<SpaceRole, number> = { viewer: 0, editor: 1, admin: 2 };
const NEEDED: Record<SpaceNeed, SpaceRole> = { view: 'viewer', edit: 'editor', admin: 'admin' };

/**
 * Die eine Stelle für Rechte auf Spaces und Seiten (S8). Jeder Zugriff der Spaces- und Seiten-Routen
 * läuft hierüber; ohne Rolle gibt es 404 statt 403, damit die Existenz verborgen bleibt.
 *
 * Meilenstein 2: Systemadmins und der Ersteller sind Space-Admins, alle anderen aktiven Benutzer
 * Bearbeiter. Frei vergebbare Space-Rollen und Seiteneinschränkungen folgen in Meilenstein 3 hier.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  roleFor(user: AuthUser, space: Pick<Space, 'createdById'>): SpaceRole | null {
    if (user.isAdmin || space.createdById === user.id) return 'admin';
    return 'editor';
  }

  access(user: AuthUser, space: Space): SpaceAccess | null {
    const role = this.roleFor(user, space);
    if (!role) return null;
    return { space, role, canEdit: space.status === 'active' && RANK[role] >= RANK.editor };
  }

  /** Wirft 404 ohne Rolle, 403 bei zu niedriger Rolle und bei Änderungen in archivierten Spaces */
  check(access: SpaceAccess | null, need: SpaceNeed): SpaceAccess {
    if (!access) throw Errors.notFound();
    if (RANK[access.role] < RANK[NEEDED[need]]) throw Errors.forbidden();
    if (need === 'edit' && access.space.status !== 'active') throw Errors.spaceArchived();
    return access;
  }

  async requireSpace(user: AuthUser, rawKey: string, need: SpaceNeed): Promise<SpaceAccess> {
    const key = rawKey.toUpperCase();
    const space = SPACE_KEY_PATTERN.test(key) ? await this.prisma.space.findUnique({ where: { key } }) : null;
    return this.check(space ? this.access(user, space) : null, need);
  }

  /** Lädt eine Seite samt Space und prüft das Recht. Gelöschte Seiten gelten als nicht vorhanden. */
  async requirePage(
    user: AuthUser,
    pageId: string,
    need: SpaceNeed,
    opts: { deleted?: boolean } = {},
  ): Promise<SpaceAccess & { page: Page }> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, include: { space: true } });
    if (!page || Boolean(page.deletedAt) !== Boolean(opts.deleted)) throw Errors.notFound();
    const { space, ...rest } = page;
    return { ...this.check(this.access(user, space), need), page: rest };
  }
}
