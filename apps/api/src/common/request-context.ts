import type { Request } from 'express';
import type { MeDto, ThemePreference } from '@wiki/shared';
import type { ActiveSession } from '../auth/session.service';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  canCreateSpace: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  theme: ThemePreference;
  /** Alle Gruppen des Benutzers einschließlich der impliziten Gruppe alle-benutzer */
  groupIds: string[];
}

/** Profil für die Weboberfläche, ohne interne Felder */
export function meDto({ groupIds: _groupIds, ...me }: AuthUser): MeDto {
  return me;
}

export interface AuthContext {
  /** Bei Anmeldung per App-Token eine Sitzung ohne Eintrag in Redis (id token:<id>, token leer) */
  session: ActiveSession;
  user: AuthUser;
  /** Gesetzt, wenn die Anfrage mit einem OAuth-Token der Android-App kam statt mit dem Session-Cookie */
  appToken?: { id: string };
}

export type WikiRequest = Request & { auth?: AuthContext; csrfToken?: string };

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unbekannt';
}

/**
 * Netz des Absenders für Sperren: IPv4 einzeln, IPv6 als /64 (ein Anschluss bekommt meist ein ganzes /64,
 * die einzelne Adresse wechselt dort beliebig).
 */
export function clientNet(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':')}::/64`;
}

export function userAgent(req: Request): string {
  return String(req.headers['user-agent'] ?? '').slice(0, 300);
}
