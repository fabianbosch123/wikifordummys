import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SYSTEM_GROUPS, type AdminUserDto, type AuditEntryDto, type GroupDto } from '@wiki/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { UserAccessService } from '../auth/user-access.service';
import { Errors } from '../common/errors';
import type { AuthContext } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { MailService } from '../mail/mail.service';
import type { CreateGroupDto, InviteUserDto, UpdateGroupDto, UpdateUserDto } from './admin.dto';

const userInclude = { groups: { select: { groupId: true } } } satisfies Prisma.UserInclude;
type UserWithGroups = Prisma.UserGetPayload<{ include: typeof userInclude }>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: UserAccessService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private async toDto(user: UserWithGroups, adminGroupId: string): Promise<AdminUserDto> {
    const groupIds = user.groups.map((g) => g.groupId);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      totpEnabled: user.totpEnabled,
      isAdmin: groupIds.includes(adminGroupId),
      groupIds,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  // ---------- Benutzer ----------

  async listUsers(): Promise<AdminUserDto[]> {
    const adminGroupId = await this.access.adminGroupId();
    const users = await this.prisma.user.findMany({ include: userInclude, orderBy: { displayName: 'asc' } });
    return Promise.all(users.map((u) => this.toDto(u, adminGroupId)));
  }

  private async getUser(id: string): Promise<UserWithGroups> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!user) throw Errors.notFound();
    return user;
  }

  private async assignableGroupIds(groupIds: string[] = []): Promise<string[]> {
    if (groupIds.length === 0) return [];
    const groups = await this.prisma.group.findMany({ where: { id: { in: groupIds } } });
    if (groups.length !== new Set(groupIds).size) throw Errors.badRequest('Unbekannte Gruppe.');
    // alle-benutzer gilt implizit und wird nicht als Mitgliedschaft gespeichert
    return groups.filter((g) => g.name !== SYSTEM_GROUPS.ALL_USERS).map((g) => g.id);
  }

  async inviteUser(dto: InviteUserDto, ctx: AuthContext, ip: string) {
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw Errors.conflict('Es gibt bereits ein Konto mit dieser E-Mail-Adresse.');
    }
    const groupIds = await this.assignableGroupIds(dto.groupIds);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        status: 'invited',
        groups: { create: groupIds.map((groupId) => ({ groupId })) },
      },
      include: userInclude,
    });
    const inviteUrl = await this.auth.createInvitation(user, ctx.user.id);
    await this.audit.log({
      action: 'admin.user.invited',
      actorId: ctx.user.id,
      targetType: 'user',
      targetId: user.id,
      ip,
      details: { email: user.email, groupIds },
    });
    return {
      user: await this.toDto(user, await this.access.adminGroupId()),
      // Ohne SMTP muss der Admin den Link selbst weitergeben
      inviteUrl: this.mail.configured ? null : inviteUrl,
    };
  }

  async resendInvitation(id: string, ctx: AuthContext, ip: string) {
    const user = await this.getUser(id);
    if (user.status !== 'invited') throw Errors.badRequest('Das Konto ist bereits aktiviert.');
    const inviteUrl = await this.auth.createInvitation(user, ctx.user.id);
    await this.audit.log({ action: 'admin.user.reinvited', actorId: ctx.user.id, targetType: 'user', targetId: id, ip });
    return { inviteUrl: this.mail.configured ? null : inviteUrl };
  }

  async updateUser(id: string, dto: UpdateUserDto, ctx: AuthContext, ip: string): Promise<AdminUserDto> {
    const user = await this.getUser(id);
    const adminGroupId = await this.access.adminGroupId();
    const wasAdmin = user.groups.some((g) => g.groupId === adminGroupId);

    if (dto.status && dto.status !== user.status) {
      if (user.status === 'invited') throw Errors.badRequest('Eingeladene Konten werden durch die Einladung aktiviert.');
      if (id === ctx.user.id && dto.status === 'deactivated') throw Errors.badRequest('Du kannst dich nicht selbst deaktivieren.');
    }
    const losesAdmin = wasAdmin && (dto.isAdmin === false || dto.status === 'deactivated');
    if (losesAdmin && user.status === 'active' && (await this.access.countActiveAdmins(id)) === 0) {
      throw Errors.badRequest('Der letzte aktive Administrator kann nicht entfernt werden.', 'LAST_ADMIN');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { displayName: dto.displayName, status: dto.status },
      });
      if (dto.isAdmin === true && !wasAdmin) {
        await tx.groupMember.create({ data: { groupId: adminGroupId, userId: id } });
      } else if (dto.isAdmin === false && wasAdmin) {
        await tx.groupMember.delete({ where: { groupId_userId: { groupId: adminGroupId, userId: id } } });
      }
    });

    if (dto.status === 'deactivated' && user.status !== 'deactivated') {
      await this.sessions.destroyAllForUser(id);
    }
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const action =
      dto.status === 'deactivated' ? 'admin.user.deactivated' : dto.status === 'active' && user.status === 'deactivated' ? 'admin.user.reactivated' : 'admin.user.updated';
    await this.audit.log({ action, actorId: ctx.user.id, targetType: 'user', targetId: id, ip, details: changes });
    if (dto.isAdmin !== undefined && dto.isAdmin !== wasAdmin) {
      await this.audit.log({
        action: 'admin.permission.changed',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: id,
        ip,
        details: { isAdmin: dto.isAdmin },
      });
    }
    return this.toDto(await this.getUser(id), adminGroupId);
  }

  async resetTwoFactor(id: string, ctx: AuthContext, ip: string) {
    const user = await this.getUser(id);
    if (user.status !== 'active') throw Errors.badRequest('Nur für aktive Konten möglich.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId: id } }),
    ]);
    // Beim nächsten Login muss 2FA neu eingerichtet werden
    await this.sessions.destroyAllForUser(id);
    await this.audit.log({ action: 'admin.user.2fa_reset', actorId: ctx.user.id, targetType: 'user', targetId: id, ip });
  }

  async revokeSessions(id: string, ctx: AuthContext, ip: string) {
    await this.getUser(id);
    const count = await this.sessions.destroyAllForUser(id);
    await this.audit.log({
      action: 'admin.user.sessions_revoked',
      actorId: ctx.user.id,
      targetType: 'user',
      targetId: id,
      ip,
      details: { count },
    });
  }

  // ---------- Gruppen ----------

  async listGroups(): Promise<GroupDto[]> {
    const groups = await this.prisma.group.findMany({ include: { members: true }, orderBy: { name: 'asc' } });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      system: g.system,
      memberIds: g.members.map((m) => m.userId),
    }));
  }

  private async getGroup(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw Errors.notFound();
    return group;
  }

  async createGroup(dto: CreateGroupDto, ctx: AuthContext, ip: string): Promise<GroupDto> {
    if (await this.prisma.group.findUnique({ where: { name: dto.name } })) {
      throw Errors.conflict('Eine Gruppe mit diesem Namen existiert bereits.');
    }
    const group = await this.prisma.group.create({ data: { name: dto.name, description: dto.description ?? '' } });
    await this.audit.log({ action: 'admin.group.created', actorId: ctx.user.id, targetType: 'group', targetId: group.id, ip, details: { name: group.name } });
    return { id: group.id, name: group.name, description: group.description, system: false, memberIds: [] };
  }

  async updateGroup(id: string, dto: UpdateGroupDto, ctx: AuthContext, ip: string) {
    await this.getGroup(id);
    await this.prisma.group.update({ where: { id }, data: { description: dto.description } });
    await this.audit.log({ action: 'admin.group.updated', actorId: ctx.user.id, targetType: 'group', targetId: id, ip, details: { ...dto } });
  }

  async deleteGroup(id: string, ctx: AuthContext, ip: string) {
    const group = await this.getGroup(id);
    if (group.system) throw Errors.badRequest('Systemgruppen können nicht gelöscht werden.');
    await this.prisma.group.delete({ where: { id } });
    await this.audit.log({ action: 'admin.group.deleted', actorId: ctx.user.id, targetType: 'group', targetId: id, ip, details: { name: group.name } });
  }

  async setMembers(id: string, userIds: string[], ctx: AuthContext, ip: string) {
    const group = await this.getGroup(id);
    if (group.name === SYSTEM_GROUPS.ALL_USERS) {
      throw Errors.badRequest('Zu alle-benutzer gehört automatisch jedes Konto.');
    }
    const unique = [...new Set(userIds)];
    if ((await this.prisma.user.count({ where: { id: { in: unique } } })) !== unique.length) {
      throw Errors.badRequest('Unbekannter Benutzer.');
    }
    if (group.name === SYSTEM_GROUPS.ADMINS) {
      const activeAdmins = await this.prisma.user.count({ where: { id: { in: unique }, status: 'active' } });
      if (activeAdmins === 0) throw Errors.badRequest('Der letzte aktive Administrator kann nicht entfernt werden.', 'LAST_ADMIN');
    }
    const before = (await this.prisma.groupMember.findMany({ where: { groupId: id } })).map((m) => m.userId);
    await this.prisma.$transaction([
      this.prisma.groupMember.deleteMany({ where: { groupId: id } }),
      this.prisma.groupMember.createMany({ data: unique.map((userId) => ({ groupId: id, userId })) }),
    ]);
    await this.audit.log({
      action: 'admin.group.members_changed',
      actorId: ctx.user.id,
      targetType: 'group',
      targetId: id,
      ip,
      details: {
        added: unique.filter((u) => !before.includes(u)),
        removed: before.filter((u) => !unique.includes(u)),
      },
    });
  }

  // ---------- Audit-Log ----------

  async listAudit(limit: number, before?: string, action?: string): Promise<AuditEntryDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        createdAt: before ? { lt: new Date(before) } : undefined,
        action: action ? { startsWith: action } : undefined,
      },
      include: { actor: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorEmail: r.actor?.email ?? null,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      ip: r.ip,
      details: (r.details ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
