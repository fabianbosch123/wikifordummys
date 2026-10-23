import { Injectable } from '@nestjs/common';
import type { RestrictionType } from '@prisma/client';
import type { PageRestrictionsDto, SubjectDto } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { AuthContext, AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { pathIds, PermissionService } from '../spaces/permission.service';
import type { SetRestrictionsDto, SubjectRefDto } from './pages.dto';

const TYPES: RestrictionType[] = ['view', 'edit'];

/** Einschränkungen „Ansehen“ und „Bearbeiten“ auf einer Seite; ausgewertet werden sie im PermissionService */
@Injectable()
export class RestrictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async get(user: AuthUser, pageId: string): Promise<PageRestrictionsDto> {
    const { page } = await this.permissions.requirePage(user, pageId, 'view');
    const rows = await this.prisma.pageRestriction.findMany({
      where: { pageId: { in: pathIds(page.path) } },
      include: { group: { select: { name: true } }, user: { select: { displayName: true } }, page: { select: { title: true } } },
    });
    const own = (type: RestrictionType): SubjectDto[] =>
      rows
        .filter((r) => r.pageId === pageId && r.type === type)
        .map((r) =>
          r.groupId ? { type: 'group' as const, id: r.groupId, name: r.group!.name } : { type: 'user' as const, id: r.userId!, name: r.user!.displayName },
        )
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'de'));
    const ancestors = pathIds(page.path).slice(0, -1);
    const inherited = ancestors.flatMap((ancestorId) =>
      TYPES.flatMap((type) => {
        const hit = rows.find((r) => r.pageId === ancestorId && r.type === type);
        return hit ? [{ pageId: ancestorId, title: hit.page.title, type }] : [];
      }),
    );
    return { view: own('view'), edit: own('edit'), inherited };
  }

  /**
   * Ersetzt die eigenen Einschränkungen der Seite. Wer nicht Space-Admin ist, muss selbst
   * (direkt oder über eine Gruppe) in jeder nicht leeren Liste stehen, damit er sich nicht aussperrt.
   */
  async set(pageId: string, dto: SetRestrictionsDto, ctx: AuthContext, ip: string): Promise<PageRestrictionsDto> {
    const access = await this.permissions.requirePage(ctx.user, pageId, 'edit');
    const all = [...dto.view, ...dto.edit];
    for (const list of [dto.view, dto.edit]) {
      if (new Set(list.map((s) => `${s.type}:${s.id}`)).size !== list.length) {
        throw Errors.badRequest('Jede Gruppe und jede Person darf nur einmal vorkommen.');
      }
    }
    const groupIds = [...new Set(all.filter((s) => s.type === 'group').map((s) => s.id))];
    const userIds = [...new Set(all.filter((s) => s.type === 'user').map((s) => s.id))];
    const [groups, users] = await Promise.all([
      this.prisma.group.count({ where: { id: { in: groupIds } } }),
      this.prisma.user.count({ where: { id: { in: userIds }, status: { not: 'deactivated' } } }),
    ]);
    if (groups !== groupIds.length || users !== userIds.length) throw Errors.badRequest('Unbekannte Gruppe oder Person.');

    if (access.role !== 'admin') {
      const includesMe = (list: SubjectRefDto[]) =>
        list.length === 0 || list.some((s) => this.permissions.matches(ctx.user, s.type === 'user' ? { userId: s.id, groupId: null } : { userId: null, groupId: s.id }));
      if (!includesMe(dto.view) || !includesMe(dto.edit)) {
        throw Errors.badRequest('Du kannst dich nicht selbst ausschließen. Füge dich oder eine deiner Gruppen hinzu.');
      }
    }

    const toRows = (type: RestrictionType, list: SubjectRefDto[]) =>
      list.map((s) => ({ pageId, type, groupId: s.type === 'group' ? s.id : null, userId: s.type === 'user' ? s.id : null }));
    await this.prisma.$transaction(async (tx) => {
      await tx.pageRestriction.deleteMany({ where: { pageId } });
      await tx.pageRestriction.createMany({ data: [...toRows('view', dto.view), ...toRows('edit', dto.edit)] });
    });

    const result = await this.get(ctx.user, pageId);
    await this.audit.log({
      action: 'page.restrictions_changed',
      actorId: ctx.user.id,
      targetType: 'page',
      targetId: pageId,
      ip,
      details: {
        spaceKey: access.space.key,
        title: access.page.title,
        view: result.view.map((s) => `${s.type}:${s.name}`),
        edit: result.edit.map((s) => `${s.type}:${s.name}`),
      },
    });
    return result;
  }
}
