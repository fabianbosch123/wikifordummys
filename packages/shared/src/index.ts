/** Gemeinsame Typen und Regeln für API und Weboberfläche. */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Liefert eine Fehlermeldung oder null, wenn das Passwort den Regeln (S1) entspricht. */
export function checkPasswordPolicy(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein.`;
  }
  if (password.trim().length === 0) {
    return 'Das Passwort darf nicht nur aus Leerzeichen bestehen.';
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    return 'Das Passwort darf nicht der E-Mail-Adresse entsprechen.';
  }
  return null;
}

export type UserStatus = 'invited' | 'active' | 'deactivated';

/** password = Passwort geprüft, 2FA fehlt; totp_setup = 2FA muss eingerichtet werden; full = voll angemeldet */
export type SessionStage = 'password' | 'totp_setup' | 'full';

export interface MeDto {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  totpEnabled: boolean;
}

export interface SessionStateDto {
  authenticated: boolean;
  stage: SessionStage | null;
  user: MeDto | null;
}

export interface SessionInfoDto {
  id: string;
  current: boolean;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface GroupDto {
  id: string;
  name: string;
  description: string;
  system: boolean;
  memberIds: string[];
}

export interface AdminUserDto {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  totpEnabled: boolean;
  isAdmin: boolean;
  groupIds: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditEntryDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryAfter?: number };
}

export const SYSTEM_GROUPS = {
  ALL_USERS: 'alle-benutzer',
  ADMINS: 'administratoren',
} as const;
