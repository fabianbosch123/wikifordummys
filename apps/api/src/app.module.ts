import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type Redis from 'ioredis';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AttachmentStorageService } from './attachments/attachment-storage.service';
import { AttachmentsController } from './attachments/attachments.controller';
import { AttachmentsService } from './attachments/attachments.service';
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
import { DirectoryController } from './directory/directory.controller';
import { APP_CONFIG, AppConfig } from './config';
import { FeaturesController } from './features/features.controller';
import { HealthController } from './health/health.controller';
import { CryptoService } from './infra/crypto.service';
import { PrismaService } from './infra/prisma.service';
import { RateLimitService } from './infra/rate-limit.service';
import { createRedis, REDIS } from './infra/redis';
import { MailService } from './mail/mail.service';
import { MeController } from './me/me.controller';
import { OfficeController } from './office/office.controller';
import { OfficeService } from './office/office.service';
import { PagesController } from './pages/pages.controller';
import { PagesService } from './pages/pages.service';
import { RestrictionsService } from './pages/restrictions.service';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { SettingsController } from './settings/settings.controller';
import { PermissionService } from './spaces/permission.service';
import { SpacesController } from './spaces/spaces.controller';
import { SpacesService } from './spaces/spaces.service';

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        MeController,
        AdminController,
        SpacesController,
        PagesController,
        AttachmentsController,
        OfficeController,
        SearchController,
        DirectoryController,
        SettingsController,
        FeaturesController,
        HealthController,
      ],
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
        PermissionService,
        SpacesService,
        PagesService,
        RestrictionsService,
        AttachmentStorageService,
        AttachmentsService,
        OfficeService,
        SearchService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [PrismaService, AuthService, AuditService, UserAccessService, MailService, REDIS],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    // Reihenfolge: CSRF → Sitzung laden → allgemeines Rate-Limit
    consumer.apply(CsrfMiddleware, AuthMiddleware, ApiRateLimitMiddleware).forRoutes('*');
  }
}
