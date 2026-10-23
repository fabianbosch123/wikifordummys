import type { Request } from 'express';
import type { ActiveSession } from '../auth/session.service';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  canCreateSpace: boolean;
  totpEnabled: boolean;
}

export interface AuthContext {
  session: ActiveSession;
  user: AuthUser;
}

export type WikiRequest = Request & { auth?: AuthContext; csrfToken?: string };

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unbekannt';
}

export function userAgent(req: Request): string {
  return String(req.headers['user-agent'] ?? '').slice(0, 300);
}
