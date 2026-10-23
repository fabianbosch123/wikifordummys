import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';

export const AUDIT_RETENTION_DAYS = 365;

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  details?: Record<string, unknown>;
}

/** Audit-Log (S12): Anmeldungen, Fehlversuche, Rechteänderungen, Admin-Aktionen. */
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Audit');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async log(event: AuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: event.action,
        actorId: event.actorId ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        ip: event.ip ?? null,
        details: (event.details ?? {}) as Prisma.InputJsonValue,
      },
    });
    // Zusätzlich als JSON-Zeile auf stdout, damit fail2ban/CrowdSec Fehlversuche auswerten können
    if (event.action.endsWith('.failed')) {
      this.logger.warn(JSON.stringify({ audit: event.action, ip: event.ip, targetId: event.targetId }));
    }
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 3600 * 1000);
    const { count } = await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => this.purgeExpired().catch((e) => this.logger.error(e));
    void run();
    this.timer = setInterval(run, 24 * 3600 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
