import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type Redis from 'ioredis';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { PasswordService } from './auth/password.service';
import { SessionService } from './auth/session.service';
import { TotpService } from './auth/totp.service';
import { UserAccessService } from './auth/user-access.service';
import { ApiRateLimitMiddleware } from './common/api-rate-limit.middleware';
import { AuthGuard } from './common/auth.guard';
import { AuthMiddleware } from './common/auth.middleware';
import { CsrfMiddleware } from './common/csrf.middleware';
import { APP_CONFIG, AppConfig } from './config';
import { HealthController } from './health/health.controller';
import { CryptoService } from './infra/crypto.service';
import { PrismaService } from './infra/prisma.service';
import { RateLimitService } from './infra/rate-limit.service';
import { createRedis, REDIS } from './infra/redis';
import { MailService } from './mail/mail.service';
import { MeController } from './me/me.controller';

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, MeController, AdminController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: REDIS,
          useFactory: () => createRedis(config.REDIS_URL),
        },
        {
          provide: 'REDIS_SHUTDOWN',
          inject: [REDIS],
          useFactory: (redis: Redis) => ({ onModuleDestroy: () => redis.quit() }),
        },
        PrismaService,
        CryptoService,
        RateLimitService,
        SessionService,
        PasswordService,
        TotpService,
        UserAccessService,
        AuditService,
        MailService,
        AuthService,
        AdminService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [PrismaService, AuthService, AuditService, UserAccessService, REDIS],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    // Reihenfolge: CSRF → Sitzung laden → allgemeines Rate-Limit
    consumer.apply(CsrfMiddleware, AuthMiddleware, ApiRateLimitMiddleware).forRoutes('*');
  }
}
