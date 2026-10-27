import { HttpException, HttpStatus } from '@nestjs/common';

/** Einheitliches Fehlerformat: { "error": { "code", "message" } } */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, ...extra } }, status);
  }
}

export class TooManyRequestsError extends ApiError {
  constructor(readonly retryAfter: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Zu viele Versuche. Bitte später erneut versuchen.', {
      retryAfter,
    });
  }
}

export const Errors = {
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Bitte anmelden.'),
  invalidCredentials: () => new ApiError(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch.'),
  invalidCode: () => new ApiError(401, 'INVALID_CODE', 'Der Code ist ungültig.'),
  forbidden: () => new ApiError(403, 'FORBIDDEN', 'Keine Berechtigung.'),
  stageRequired: (stage: string) =>
    new ApiError(401, 'STAGE_REQUIRED', 'Die Anmeldung ist noch nicht abgeschlossen.', { stage }),
  passwordChangeRequired: () =>
    new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Bitte zuerst das Startpasswort ändern.'),
  csrf: () => new ApiError(403, 'CSRF', 'Ungültiges oder fehlendes CSRF-Token.'),
  notFound: () => new ApiError(404, 'NOT_FOUND', 'Nicht gefunden.'),
  invalidToken: () => new ApiError(400, 'INVALID_TOKEN', 'Der Link ist ungültig oder abgelaufen.'),
  badRequest: (message: string, code = 'BAD_REQUEST') => new ApiError(400, code, message),
  conflict: (message: string, extra: Record<string, unknown> = {}) => new ApiError(409, 'CONFLICT', message, extra),
  spaceArchived: () => new ApiError(403, 'SPACE_ARCHIVED', 'Der Space ist archiviert und kann nicht bearbeitet werden.'),
  invalidContent: (message: string) => new ApiError(400, 'INVALID_CONTENT', message),
  tooLarge: (maxMb: number) => new ApiError(413, 'TOO_LARGE', `Die Datei ist zu groß (höchstens ${maxMb} MB).`),
  storageFull: () =>
    new ApiError(507, 'STORAGE_FULL', 'Auf dem Server ist kein Platz mehr für Dateien. Bitte die Administration informieren.'),
  quotaExceeded: (mb: number) =>
    new ApiError(413, 'QUOTA_EXCEEDED', `Du hast in den letzten 24 Stunden schon ${mb} MB hochgeladen. Bitte später erneut versuchen.`),
};
