import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { SessionStage } from '@wiki/shared';
import type { AuthContext, WikiRequest } from './request-context';

export const PUBLIC_KEY = 'wiki:public';
export const STAGES_KEY = 'wiki:stages';
export const ADMIN_KEY = 'wiki:admin';
export const PASSWORD_CHANGE_KEY = 'wiki:password-change';
export const APP_TOKEN_KEY = 'wiki:app-token';

/** Route ohne Anmeldung erreichbar */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Route auch mit unvollständiger Anmeldung erreichbar (z. B. 2FA-Eingabe) */
export const AllowStages = (...stages: SessionStage[]) => SetMetadata(STAGES_KEY, stages);

/** Route auch erreichbar, solange das Startpasswort noch nicht geändert ist */
export const AllowPendingPasswordChange = () => SetMetadata(PASSWORD_CHANGE_KEY, true);

/**
 * Route auch mit einem Token der Android-App erreichbar (nur GET und HEAD, siehe auth.guard.ts).
 * Ohne diese Markierung gilt ein App-Token nicht: Anmeldung, Konto, Tokens und Administration bleiben der Weboberfläche.
 */
export const AppTokenAllowed = () => SetMetadata(APP_TOKEN_KEY, true);

/** Nur für Systemadministratoren */
export const AdminOnly = () => SetMetadata(ADMIN_KEY, true);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<WikiRequest>();
  if (!req.auth) throw new Error('Auth-Kontext fehlt; Route ist falsch markiert');
  return req.auth;
});
