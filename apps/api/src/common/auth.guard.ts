import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionStage } from '@wiki/shared';
import { ADMIN_KEY, PASSWORD_CHANGE_KEY, PUBLIC_KEY, STAGES_KEY } from './decorators';
import { Errors } from './errors';
import type { WikiRequest } from './request-context';

/**
 * Zentraler Guard für jede Route (S8): Standard ist „verweigern“.
 * Ohne @Public() braucht jede Route eine vollständige Anmeldung inklusive 2FA (S2).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<WikiRequest>();
    if (!req.auth) throw Errors.unauthenticated();

    const allowed = this.reflector.getAllAndOverride<SessionStage[]>(STAGES_KEY, targets) ?? ['full'];
    if (!allowed.includes(req.auth.session.stage)) {
      // Unvollständige Anmeldung: wie nicht angemeldet behandeln, aber Stufe mitteilen
      if (req.auth.session.stage !== 'full') throw Errors.stageRequired(req.auth.session.stage);
      throw Errors.forbidden();
    }

    // Startpasswort aus der Kommandozeile: nach vollständiger Anmeldung bis zur Änderung nur Profil, Passwort und Abmelden
    if (
      req.auth.session.stage === 'full' &&
      req.auth.user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_KEY, targets)
    ) {
      throw Errors.passwordChangeRequired();
    }

    if (this.reflector.getAllAndOverride<boolean>(ADMIN_KEY, targets) && !req.auth.user.isAdmin) {
      throw Errors.forbidden();
    }
    return true;
  }
}
