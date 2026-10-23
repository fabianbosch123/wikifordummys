import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type Space } from '@prisma/client';
import { docToText, SYSTEM_GROUPS, type DocNode, type SpaceDto, type SpacePermissionDto, type UserRefDto } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { AuthContext, AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import type { CreateSpaceDto, SetSpacePermissionsDto, UpdateSpaceDto } from './spaces.dto';
import { highestRole, PermissionService, type SpaceAccess } from './permission.service';

export function userRef(user: { id: string; displayName: string } | null | undefined): UserRefDto | null {
  return user ? { id: user.id, displayName: user.displayName } : null;
}

const spaceInclude = { createdBy: { select: { id: true, displayName: true } } } satisfies Prisma.SpaceInclude;
type SpaceWithCreator = Prisma.SpaceGetPayload<{ include: typeof spaceInclude }>;

/** Startinhalt der Startseite eines neuen Spaces */
function homeContent(description: string): DocNode {
  const paragraph: DocNode = description ? { type: 'paragraph', content: [{ type: 'text', text: description }] } : { type: 'paragraph' };
  return { type: 'doc', content: [paragraph] };
}

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  toDto(space: SpaceWithCreator, access: SpaceAccess): SpaceDto {
    return {
      id: space.id,
      key: space.key,
      name: space.name,
      description: space.description,
      status: space.status,
      homePageId: space.homePageId,
      createdBy: userRef(space.createdBy),
      createdAt: space.createdAt.toISOString(),
      updatedAt: space.updatedAt.toISOString(),
      role: access.role,
      canEdit: access.canEdit,
    };
  }

  private async load(space: Space): Promise<SpaceWithCreator> {
    return this.prisma.space.findUniqueOrThrow({ where: { id: space.id }, include: spaceInclude });
  }

  async list(user: AuthUser, status: 'active' | 'archived' = 'active'): Promise<SpaceDto[]> {
    // Dieselben Rollen wie beim Einzelzugriff filtern die Liste (S8)
    const roles = await this.permissions.roles(user);
    const spaces = await this.prisma.space.findMany({
      where: { status, id: { in: [...roles.keys()] } },
      include: spaceInclude,
      orderBy: { name: 'asc' },
    });
    return spaces.flatMap((s) => {
      const access = this.permissions.access(s, roles.get(s.id) ?? null);
      return access ? [this.toDto(s, access)] : [];
    });
  }

  async get(user: AuthUser, key: string): Promise<SpaceDto> {
    const access = await this.permissions.requireSpace(user, key, 'view');
    return this.toDto(await this.load(access.space), access);
  }

  async create(dto: CreateSpaceDto, ctx: AuthContext, ip: string): Promise<SpaceDto> {
    if (!ctx.user.canCreateSpace) throw Errors.forbidden();
    if (await this.prisma.space.findUnique({ where: { key: dto.key } })) {
      throw Errors.conflict('Ein Space mit diesem Schlüssel existiert bereits.');
    }
    const spaceId = randomUUID();
    const pageId = randomUUID();
    const content = homeContent(dto.description ?? '');
    const contentText = docToText(content);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.space.create({
          data: { id: spaceId, key: dto.key, name: dto.name, description: dto.description ?? '', createdById: ctx.user.id },
        });
        await tx.page.create({
          data: {
            id: pageId,
            spaceId,
            path: `/${pageId}/`,
            position: 0,
            title: dto.name,
            content: content as unknown as Prisma.InputJsonValue,
            contentText,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
            versions: {
              create: { version: 1, title: dto.name, content: content as unknown as Prisma.InputJsonValue, contentText, authorId: ctx.user.id },
            },
          },
        });
        await tx.space.update({ where: { id: spaceId }, data: { homePageId: pageId } });
        // Der Ersteller verwaltet den Space; offene Spaces dürfen alle Benutzer bearbeiten
        await tx.spacePermission.create({ data: { spaceId, userId: ctx.user.id, role: 'admin' } });
        if (dto.open ?? true) {
          const allUsers = await tx.group.findUniqueOrThrow({ where: { name: SYSTEM_GROUPS.ALL_USERS } });
          await tx.spacePermission.create({ data: { spaceId, groupId: allUsers.id, role: 'editor' } });
        }
      });
    } catch (err) {
      // Gleichzeitig angelegter Space mit demselben Schlüssel
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('Ein Space mit diesem Schlüssel existiert bereits.');
      }
      throw err;
    }
    await this.audit.log({
      action: 'space.created',
      actorId: ctx.user.id,
      targetType: 'space',
      targetId: spaceId,
      ip,
      details: { key: dto.key, open: dto.open ?? true },
    });
    return this.get(ctx.user, dto.key);
  }

  async update(key: string, dto: UpdateSpaceDto, ctx: AuthContext, ip: string): Promise<SpaceDto> {
    const { space } = await this.permissions.requireSpace(ctx.user, key, 'admin');
    await this.prisma.space.update({
      where: { id: space.id },
      data: { name: dto.name, description: dto.description, status: dto.status },
    });
    const action =
      dto.status && dto.status !== space.status ? (dto.status === 'archived' ? 'space.archived' : 'space.unarchived') : 'space.updated';
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    await this.audit.log({ action, actorId: ctx.user.id, targetType: 'space', targetId: space.id, ip, details: { key: space.key, ...changes } });
    return this.get(ctx.user, space.key);
  }

  // ---------- Rollen im Space ----------

  async permissionsOf(user: AuthUser, key: string): Promise<SpacePermissionDto[]> {
    const { space } = await this.permissions.requireSpace(user, key, 'admin');
    const rows = await this.prisma.spacePermission.findMany({
      where: { spaceId: space.id },
      include: { group: { select: { name: true } }, user: { select: { displayName: true } } },
    });
    const dtos = rows.map((r) => ({
      subject: r.groupId
        ? { type: 'group' as const, id: r.groupId, name: r.group!.name }
        : { type: 'user' as const, id: r.userId!, name: r.user!.displayName },
      role: r.role,
    }));
    // Gruppen vor Personen, jeweils alphabetisch
    return dtos.sort((a, b) => a.subject.type.localeCompare(b.subject.type) || a.subject.name.localeCompare(b.subject.name, 'de'));
  }

  /** Ersetzt alle Rollen eines Spaces. Mindestens ein Space-Admin muss bleiben, und man kann sich nicht selbst aussperren. */
  async setPermissions(key: string, dto: SetSpacePermissionsDto, ctx: AuthContext, ip: string): Promise<SpacePermissionDto[]> {
    const { space } = await this.permissions.requireSpace(ctx.user, key, 'admin');
    const entries = dto.entries;
    const seen = new Set(entries.map((e) => `${e.type}:${e.id}`));
    if (seen.size !== entries.length) throw Errors.badRequest('Jede Gruppe und jede Person darf nur einmal vorkommen.');
    if (!entries.some((e) => e.role === 'admin')) throw Errors.badRequest('Mindestens eine Gruppe oder Person muss Space-Admin sein.');

    const groupIds = entries.filter((e) => e.type === 'group').map((e) => e.id);
    const userIds = entries.filter((e) => e.type === 'user').map((e) => e.id);
    const [groups, users] = await Promise.all([
      this.prisma.group.count({ where: { id: { in: groupIds } } }),
      this.prisma.user.count({ where: { id: { in: userIds }, status: { not: 'deactivated' } } }),
    ]);
    if (groups !== groupIds.length || users !== userIds.length) throw Errors.badRequest('Unbekannte Gruppe oder Person.');

    if (!ctx.user.isAdmin) {
      const own = entries.filter((e) => (e.type === 'user' ? e.id === ctx.user.id : ctx.user.groupIds.includes(e.id)));
      if (highestRole(own.map((e) => e.role)) !== 'admin') {
        throw Errors.badRequest('Du kannst dir nicht selbst die Admin-Rolle nehmen. Das kann nur ein anderer Space-Admin.');
      }
    }

    const before = await this.permissionsOf(ctx.user, space.key);
    await this.prisma.$transaction(async (tx) => {
      await tx.spacePermission.deleteMany({ where: { spaceId: space.id } });
      await tx.spacePermission.createMany({
        data: entries.map((e) => ({
          spaceId: space.id,
          role: e.role,
          groupId: e.type === 'group' ? e.id : null,
          userId: e.type === 'user' ? e.id : null,
        })),
      });
    });
    const after = await this.permissionsOf(ctx.user, space.key);
    const summary = (list: SpacePermissionDto[]) => list.map((p) => `${p.subject.type}:${p.subject.name}=${p.role}`);
    await this.audit.log({
      action: 'space.permissions_changed',
      actorId: ctx.user.id,
      targetType: 'space',
      targetId: space.id,
      ip,
      details: { key: space.key, before: summary(before), after: summary(after) },
    });
    return after;
  }
}
