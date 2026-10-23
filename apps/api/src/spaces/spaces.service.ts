import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type Space } from '@prisma/client';
import { docToText, type DocNode, type SpaceDto, type UserRefDto } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { AuthContext, AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import type { CreateSpaceDto, UpdateSpaceDto } from './spaces.dto';
import { PermissionService, type SpaceAccess } from './permission.service';

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
    const spaces = await this.prisma.space.findMany({ where: { status }, include: spaceInclude, orderBy: { name: 'asc' } });
    // Dieselbe Prüfung wie beim Einzelzugriff filtert die Liste (S8)
    return spaces.flatMap((s) => {
      const access = this.permissions.access(user, s);
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
      });
    } catch (err) {
      // Gleichzeitig angelegter Space mit demselben Schlüssel
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('Ein Space mit diesem Schlüssel existiert bereits.');
      }
      throw err;
    }
    await this.audit.log({ action: 'space.created', actorId: ctx.user.id, targetType: 'space', targetId: spaceId, ip, details: { key: dto.key } });
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
}
