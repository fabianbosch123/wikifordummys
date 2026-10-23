import { Injectable } from '@nestjs/common';
import { GlobalPermissionType } from '@prisma/client';
import { SYSTEM_GROUPS } from '@wiki/shared';
import { PrismaService } from '../infra/prisma.service';
import type { AuthUser } from '../common/request-context';

/** Lädt Benutzer samt globalen Rechten. Die Gruppe alle-benutzer gilt implizit für jedes aktive Konto. */
@Injectable()
export class UserAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async globalPermissions(userId: string): Promise<Set<GlobalPermissionType>> {
    const rows = await this.prisma.globalPermission.findMany({
      where: {
        group: {
          OR: [{ name: SYSTEM_GROUPS.ALL_USERS }, { members: { some: { userId } } }],
        },
      },
      select: { permission: true },
    });
    return new Set(rows.map((r) => r.permission));
  }

  /** Nur aktive Konten; sonst null */
  async loadActive(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'active') return null;
    const [perms, groups] = await Promise.all([
      this.globalPermissions(user.id),
      this.prisma.group.findMany({
        where: { OR: [{ name: SYSTEM_GROUPS.ALL_USERS }, { members: { some: { userId } } }] },
        select: { id: true },
      }),
    ]);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      totpEnabled: user.totpEnabled,
      mustChangePassword: user.mustChangePassword,
      isAdmin: perms.has('admin'),
      canCreateSpace: perms.has('admin') || perms.has('create_space'),
      groupIds: groups.map((g) => g.id),
    };
  }

  async adminGroupId(): Promise<string> {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { name: SYSTEM_GROUPS.ADMINS } });
    return group.id;
  }

  async countActiveAdmins(excludeUserId?: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        status: 'active',
        id: excludeUserId ? { not: excludeUserId } : undefined,
        groups: { some: { group: { permissions: { some: { permission: 'admin' } } } } },
      },
    });
  }
}
