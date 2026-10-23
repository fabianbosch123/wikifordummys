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
  /** Startpasswort aus der Kommandozeile: vor allem anderen ändern */
  mustChangePassword: boolean;
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
/** Rolle im Space: admin verwaltet den Space, editor bearbeitet Seiten, viewer liest nur */
export type SpaceRole = 'admin' | 'editor' | 'viewer';
export const SPACE_ROLES: readonly SpaceRole[] = ['admin', 'editor', 'viewer'];

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
  /** Darf Einschränkungen der Seite ändern */
  canRestrict: boolean;
  /** Für die Seite gelten eigene oder geerbte Einschränkungen */
  restricted: { view: boolean; edit: boolean };
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

// ---------- Rechte, Anhänge, Suche (Meilenstein 3) ----------

/** Gruppe oder einzelner Benutzer, dem ein Recht gegeben wird */
export interface SubjectDto {
  type: 'group' | 'user';
  id: string;
  /** Gruppenname bzw. Anzeigename */
  name: string;
}

export interface SpacePermissionDto {
  subject: SubjectDto;
  role: SpaceRole;
}

export type RestrictionType = 'view' | 'edit';

export interface PageRestrictionsDto {
  /** Eigene Einschränkungen der Seite; leere Liste = keine Einschränkung dieser Art */
  view: SubjectDto[];
  edit: SubjectDto[];
  /** Vorfahren, deren Einschränkungen zusätzlich gelten */
  inherited: { pageId: string; title: string; type: RestrictionType }[];
}

/** Benutzer und Gruppen zur Auswahl bei Rechten (ohne E-Mail-Adressen) */
export interface DirectoryDto {
  users: UserRefDto[];
  groups: { id: string; name: string }[];
}

export const ATTACHMENT_DEFAULT_MAX_MB = 50;

export interface AttachmentDto {
  id: string;
  pageId: string;
  filename: string;
  /** Am Inhalt erkannter Typ; unbekannte Typen sind application/octet-stream */
  mimeType: string;
  sizeBytes: number;
  /** Bilder werden im Browser angezeigt, PDF im Browser geöffnet; alles andere wird heruntergeladen */
  preview: 'image' | 'pdf' | null;
  uploadedBy: UserRefDto | null;
  createdAt: string;
  /** Adresse zum Abrufen, z. B. für Bilder in Seiten */
  url: string;
}

export interface SearchHitDto {
  id: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  /** Textausschnitt; match = Treffer zum Hervorheben */
  snippet: { text: string; match: boolean }[];
  updatedAt: string;
}

export interface SearchResultDto {
  results: SearchHitDto[];
  hasMore: boolean;
}

export const SEARCH_PAGE_SIZE = 20;

// ---------- Meilenstein 4: Mailversand ----------

/** tls = SSL/TLS ab Verbindungsbeginn (meist Port 465), starttls = Upgrade nach dem Verbindungsaufbau (meist 587) */
export type SmtpSecurity = 'tls' | 'starttls' | 'none';
export const SMTP_SECURITY: readonly SmtpSecurity[] = ['tls', 'starttls', 'none'];

export interface MailSettingsDto {
  /** admin = in der Administration gespeichert (Vorrang), env = SMTP_URL aus .env, none = kein Versand */
  source: 'admin' | 'env' | 'none';
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  hasPassword: boolean;
  from: string;
  /** In .env ist ein SMTP-Zugang hinterlegt, auf den sich zurückschalten lässt */
  envConfigured: boolean;
  updatedAt: string | null;
}

export interface MailSettingsInput {
  host: string;
  port: number;
  security: SmtpSecurity;
  username?: string;
  /** Weglassen behält das bisherige Passwort */
  password?: string;
  from: string;
  /** Verbindung vor dem Speichern nicht prüfen */
  skipVerify?: boolean;
}
