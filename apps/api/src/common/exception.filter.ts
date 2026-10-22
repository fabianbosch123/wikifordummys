import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { TooManyRequestsError } from './errors';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Fehler');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof TooManyRequestsError) {
      res.setHeader('Retry-After', String(exception.retryAfter));
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'object') {
        res.status(status).json(body);
        return;
      }
      // Nest-eigene Fehler (z. B. Validierung, 404 für unbekannte Routen) in das einheitliche Format bringen
      const raw = typeof body === 'object' && body !== null ? (body as { message?: unknown }).message : body;
      const message = Array.isArray(raw) ? raw.join('; ') : String(raw ?? exception.message);
      const code = status === 400 ? 'VALIDATION' : status === 404 ? 'NOT_FOUND' : `HTTP_${status}`;
      res.status(status).json({ error: { code, message } });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Interner Fehler.' } });
  }
}
