import { Injectable } from '@nestjs/common';
import { GlobalPermissionType } from '@prisma/client';
import { SYSTEM_GROUPS } from '@wiki/shared';
import { PrismaService } from '../infra/prisma.service';
import type { AuthUser } from '../common/request-context';

/** Lädt Benutzer samt globalen Rechten. Die Gruppe alle-benutzer gilt implizit für jedes aktive Konto. */
@Injectable()
export class UserAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nur aktive Konten; sonst null. Läuft bei jeder Anfrage (AuthMiddleware), deshalb nur zwei Abfragen
   * parallel: das Konto und seine Gruppen samt globaler Rechte.
   */
  async loadActive(userId: string): Promise<AuthUser | null> {
    const [user, groups] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.group.findMany({
        where: { OR: [{ name: SYSTEM_GROUPS.ALL_USERS }, { members: { some: { userId } } }] },
        select: { id: true, permissions: { select: { permission: true } } },
      }),
    ]);
    if (!user || user.status !== 'active') return null;
    const perms = new Set<GlobalPermissionType>(groups.flatMap((g) => g.permissions.map((p) => p.permission)));
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
