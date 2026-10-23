/** Gemeinsame Typen und Regeln für API und Weboberfläche. */

export * from './content';
import type { DocNode } from './content';

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
  /** Darf eigene Spaces anlegen (globales Recht create_space) */
  canCreateSpace: boolean;
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

// ---------- Spaces und Seiten (Meilenstein 2) ----------

export const SPACE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const PAGE_TITLE_MAX_LENGTH = 200;

export type SpaceStatus = 'active' | 'archived';
/** Rolle im Space; ab Meilenstein 3 frei vergebbar, bis dahin Space-Admin = Ersteller und Systemadmins */
export type SpaceRole = 'admin' | 'editor' | 'viewer';

export interface UserRefDto {
  id: string;
  displayName: string;
}

export interface SpaceDto {
  id: string;
  key: string;
  name: string;
  description: string;
  status: SpaceStatus;
  homePageId: string | null;
  createdBy: UserRefDto | null;
  createdAt: string;
  updatedAt: string;
  /** Rolle des angemeldeten Benutzers */
  role: SpaceRole;
  /** Darf Seiten anlegen und bearbeiten (Rolle und Space nicht archiviert) */
  canEdit: boolean;
}

export interface TreeNodeDto {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
}

export interface PageDto {
  id: string;
  spaceKey: string;
  parentId: string | null;
  title: string;
  content: DocNode;
  version: number;
  isHome: boolean;
  /** Vorfahren von der Wurzel bis zum direkten Elternteil */
  ancestors: { id: string; title: string }[];
  createdBy: UserRefDto | null;
  updatedBy: UserRefDto | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface PageVersionSummaryDto {
  version: number;
  title: string;
  author: UserRefDto | null;
  createdAt: string;
  /** Wiederhergestellt aus dieser Version, sonst null */
  restoredFrom: number | null;
}

export interface PageVersionDto extends PageVersionSummaryDto {
  pageId: string;
  content: DocNode;
}

export interface DiffLineDto {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

export interface PageDiffDto {
  from: number;
  to: number;
  title: { from: string; to: string };
  lines: DiffLineDto[];
}

export interface TrashEntryDto {
  id: string;
  title: string;
  deletedAt: string;
  deletedBy: UserRefDto | null;
  /** Anzahl mitgelöschter Unterseiten */
  descendants: number;
  /** Endgültige Löschung nach Ablauf der Frist */
  purgeAt: string;
}

export const TRASH_RETENTION_DAYS = 30;

export interface ConflictBody {
  error: { code: 'CONFLICT'; message: string; current: PageDto };
}
