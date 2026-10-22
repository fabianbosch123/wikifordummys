import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { statfs } from 'node:fs/promises';
import { Public } from '../common/decorators';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async health() {
    const checks: Record<string, string> = {};
    await this.prisma.$queryRaw`SELECT 1`.then(
      () => (checks.database = 'ok'),
      () => (checks.database = 'fehler'),
    );
    await this.redis.ping().then(
      () => (checks.redis = 'ok'),
      () => (checks.redis = 'fehler'),
    );
    try {
      const fs = await statfs(process.env.ATTACHMENTS_DIR ?? '/');
      const freeRatio = fs.bavail / fs.blocks;
      checks.disk = freeRatio > 0.1 ? 'ok' : 'knapp';
    } catch {
      checks.disk = 'unbekannt';
    }
    const ok = checks.database === 'ok' && checks.redis === 'ok';
    const body = { status: ok ? 'ok' : 'fehler', checks };
    if (!ok) throw new HttpException(body, 503);
    return body;
  }
}
