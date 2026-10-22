import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config';
import { RateLimitService } from '../infra/rate-limit.service';
import { clientIp, WikiRequest } from './request-context';

/** Allgemeines Limit (S3): 300 Anfragen pro Minute je Benutzer, ohne Anmeldung je IP. */
@Injectable()
export class ApiRateLimitMiddleware implements NestMiddleware {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly limiter: RateLimitService,
  ) {}

  async use(req: WikiRequest, _res: Response, next: NextFunction) {
    try {
      const subject = req.auth ? `u:${req.auth.user.id}` : `ip:${clientIp(req)}`;
      await this.limiter.enforce([{ key: `api:${subject}`, limit: this.config.RATE_API_PER_MINUTE, windowSec: 60 }]);
      next();
    } catch (err) {
      next(err);
    }
  }
}
