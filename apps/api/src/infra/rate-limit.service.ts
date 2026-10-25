import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { TooManyRequestsError } from '../common/errors';
import { REDIS } from './redis';

export interface RateResult {
  allowed: boolean;
  retryAfter: number;
}

/**
 * Feste Zeitfenster und steigende Sperren in Redis (S3).
 * Schlüssel für Konten werden vorher gehasht, damit keine E-Mails im Klartext in Redis liegen.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSec: number): Promise<RateResult> {
    const fullKey = `rl:${key}`;
    // Eine Runde zu Redis: Zähler samt Ablauf nur anlegen, wenn er fehlt (NX), dann hochzählen; INCR behält den Ablauf
    const [, [, count], [, ttl]] = (await this.redis
      .multi()
      .set(fullKey, 0, 'EX', windowSec, 'NX')
      .incr(fullKey)
      .ttl(fullKey)
      .exec()) as [unknown, [null, number], [null, number]];
    // Nur noch für Zähler ohne Ablauf aus älteren Ständen
    if (ttl < 0) await this.redis.expire(fullKey, windowSec);
    const retryAfter = ttl > 0 ? ttl : windowSec;
    return { allowed: count <= limit, retryAfter };
  }

  /** Wirft 429, wenn eines der Limits überschritten ist. Alle Zähler werden erhöht. */
  async enforce(rules: { key: string; limit: number; windowSec: number }[]): Promise<void> {
    let blocked: RateResult | null = null;
    for (const rule of rules) {
      const res = await this.hit(rule.key, rule.limit, rule.windowSec);
      if (!res.allowed && (!blocked || res.retryAfter > blocked.retryAfter)) blocked = res;
    }
    if (blocked) throw new TooManyRequestsError(blocked.retryAfter);
  }

  /** Prüft eine bestehende Sperre (steigende Sperre nach Fehlversuchen). */
  async assertNotLocked(scope: string): Promise<void> {
    const ttl = await this.redis.pttl(`lock:${scope}`);
    if (ttl > 0) throw new TooManyRequestsError(Math.ceil(ttl / 1000));
  }

  /**
   * Zählt einen Fehlversuch. Ab `threshold` Fehlversuchen wird gesperrt:
   * 1 Minute, dann jeweils doppelt so lange, höchstens 1 Stunde.
   */
  async registerFailure(scope: string, threshold = 5): Promise<number> {
    const failKey = `fail:${scope}`;
    const failures = await this.redis.incr(failKey);
    await this.redis.expire(failKey, 24 * 3600);
    if (failures >= threshold) {
      const seconds = Math.min(60 * 2 ** (failures - threshold), 3600);
      await this.redis.set(`lock:${scope}`, '1', 'EX', seconds);
    }
    return failures;
  }

  async clearFailures(scope: string): Promise<void> {
    await this.redis.del(`fail:${scope}`, `lock:${scope}`);
  }
}
