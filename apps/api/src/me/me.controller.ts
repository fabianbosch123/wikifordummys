import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { PASSWORD_MAX_LENGTH, type MeDto, type SessionInfoDto } from '@wiki/shared';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { AllowPendingPasswordChange, AppTokenAllowed, Auth } from '../common/decorators';
import { Errors } from '../common/errors';
import { AuthContext, clientIp, meDto, userAgent, WikiRequest } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';

class UpdateMeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  displayName: string;
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

class TotpConfirmDto {
  @Matches(/^\d{6}$/, { message: 'Der Code besteht aus 6 Ziffern.' })
  code: string;
}

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @AllowPendingPasswordChange()
  @AppTokenAllowed()
  @Get()
  me(@Auth() ctx: AuthContext): MeDto {
    return meDto(ctx.user);
  }

  @Patch()
  async update(@Body() dto: UpdateMeDto, @Auth() ctx: AuthContext): Promise<MeDto> {
    await this.prisma.user.update({ where: { id: ctx.user.id }, data: { displayName: dto.displayName } });
    return { ...meDto(ctx.user), displayName: dto.displayName };
  }

  @AllowPendingPasswordChange()
  @Post('password')
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    await this.auth.changePassword(ctx.session, dto.currentPassword, dto.newPassword, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  async regenerateCodes(@Body() dto: TotpConfirmDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    const recoveryCodes = await this.auth.regenerateRecoveryCodes(ctx.user.id, dto.code, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    return { recoveryCodes };
  }

  @Get('sessions')
  async listSessions(@Auth() ctx: AuthContext): Promise<SessionInfoDto[]> {
    const list = await this.sessions.listForUser(ctx.user.id);
    return list.map((s) => ({
      id: s.id,
      current: s.id === ctx.session.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: new Date(s.createdAt).toISOString(),
      lastSeenAt: new Date(s.lastSeenAt).toISOString(),
    }));
  }

  /** Alle anderen Geräte abmelden */
  @Delete('sessions')
  @HttpCode(204)
  async revokeOthers(@Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    const count = await this.sessions.destroyAllForUser(ctx.user.id, ctx.session.id);
    await this.audit.log({ action: 'session.revoked_others', actorId: ctx.user.id, ip: clientIp(req), details: { count } });
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@Param('id') id: string, @Auth() ctx: AuthContext, @Req() req: WikiRequest) {
    if (!/^[0-9a-f]{64}$/.test(id)) throw Errors.notFound();
    const removed = await this.sessions.destroyById(ctx.user.id, id);
    if (!removed) throw Errors.notFound();
    await this.audit.log({ action: 'session.revoked', actorId: ctx.user.id, ip: clientIp(req) });
  }
}
