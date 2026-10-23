import { Controller, Get } from '@nestjs/common';
import type { DirectoryDto } from '@wiki/shared';
import { PrismaService } from '../infra/prisma.service';

/** Benutzer und Gruppen zur Auswahl bei Space-Rollen und Seiteneinschränkungen; ohne E-Mail-Adressen */
@Controller('directory')
export class DirectoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<DirectoryDto> {
    const [users, groups] = await Promise.all([
      this.prisma.user.findMany({ where: { status: 'active' }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } }),
      this.prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { users, groups };
  }
}
