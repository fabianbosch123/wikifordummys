import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { SessionStateDto } from '@wiki/shared';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config';
import { AuditService } from '../audit/audit.service';
import { clearSessionCookie, setCsrfCookie, setSessionCookie } from '../common/cookies';
import { AllowPendingPasswordChange, AllowStages, Auth, Public } from '../common/decorators';
import { AuthContext, clientIp, meDto, userAgent, WikiRequest } from '../common/request-context';
import { CryptoService } from '../infra/crypto.service';
import { AuthService, ClientInfo } from './auth.service';
import { AcceptInviteDto, CodeDto, ForgotPasswordDto, LoginDto, ResetPasswordDto, TotpCodeDto } from './dto';
import { ActiveSession, SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private client(req: WikiRequest): ClientInfo {
    return { ip: clientIp(req), userAgent: userAgent(req) };
  }

  /** Setzt das neue Session-Cookie und ein frisches CSRF-Token. */
  private establish(res: Response, session: ActiveSession): { csrfToken: string; stage: string } {
    setSessionCookie(res, this.config, session.token);
    const csrfToken = this.crypto.randomToken(32);
    setCsrfCookie(res, this.config, csrfToken);
    return { csrfToken, stage: session.stage };
  }

  private async dropCurrent(req: WikiRequest) {
    if (req.auth) await this.sessions.destroy(req.auth.session);
  }

  @Public()
  @Get('csrf')
  csrf(@Req() req: WikiRequest) {
    return { csrfToken: req.csrfToken };
  }

  @Public()
  @Get('session')
  session(@Req() req: WikiRequest): SessionStateDto {
    if (!req.auth) return { authenticated: false, stage: null, user: null };
    const { session, user } = req.auth;
    return {
      authenticated: session.stage === 'full',
      stage: session.stage,
      user: session.stage === 'full' ? meDto(user) : null,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: WikiRequest, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(dto.email, dto.password, this.client(req));
    await this.dropCurrent(req);
    return this.establish(res, session);
  }

  @AllowStages('password')
  @Post('2fa')
  @HttpCode(200)
  async secondFactor(@Body() dto: CodeDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.verifySecondFactor(ctx.session, dto.code, this.client(req));
    return this.establish(res, session);
  }

  @AllowStages('totp_setup')
  @Post('2fa/setup')
  @HttpCode(200)
  startSetup(@Auth() ctx: AuthContext) {
    return this.auth.startTotpSetup(ctx.session, ctx.user.email);
  }

  @AllowStages('totp_setup')
  @Post('2fa/setup/confirm')
  @HttpCode(200)
  async confirmSetup(@Body() dto: TotpCodeDto, @Auth() ctx: AuthContext, @Req() req: WikiRequest, @Res({ passthrough: true }) res: Response) {
    const { session, recoveryCodes } = await this.auth.confirmTotpSetup(ctx.session, dto.code, this.client(req));
    return { ...this.establish(res, session), recoveryCodes };
  }

  @AllowStages('password', 'totp_setup', 'full')
  @AllowPendingPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(@Auth() ctx: AuthContext, @Req() req: WikiRequest, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(ctx.session);
    clearSessionCookie(res, this.config);
    await this.audit.log({ action: 'auth.logout', actorId: ctx.user.id, ip: clientIp(req) });
  }

  @Public()
  @Get('invite/:token')
  describeInvite(@Param('token') token: string, @Req() req: WikiRequest) {
    return this.auth.describeInvitation(token, this.client(req));
  }

  @Public()
  @Post('invite/accept')
  @HttpCode(200)
  async acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: WikiRequest, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.acceptInvitation(dto.token, dto.password, dto.displayName, this.client(req));
    await this.dropCurrent(req);
    return this.establish(res, session);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: WikiRequest) {
    await this.auth.requestPasswordReset(dto.email, this.client(req));
    return { message: 'Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail verschickt.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto, @Req() req: WikiRequest) {
    await this.auth.resetPassword(dto.token, dto.password, this.client(req));
  }
}
