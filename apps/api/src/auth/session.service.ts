import { Inject, Injectable } from '@nestjs/common';
import type { SessionStage } from '@wiki/shared';
import type Redis from 'ioredis';
import { CryptoService } from '../infra/crypto.service';
import { REDIS } from '../infra/redis';

export const SESSION_IDLE_SEC = 12 * 3600; // S4: Leerlauf-Timeout 12 h
export const SESSION_ABSOLUTE_SEC = 14 * 24 * 3600; // S4: absolut 14 Tage
export const SESSION_PARTIAL_SEC = 15 * 60; // halbe Anmeldung (2FA ausstehend)

export interface StoredSession {
  userId: string;
  stage: SessionStage;
  createdAt: number;
  lastSeenAt: number;
  ip: string;
  userAgent: string;
  /** Verschlüsseltes TOTP-Geheimnis während der Einrichtung */
  pendingTotpSecret?: string;
}

export interface ActiveSession extends StoredSession {
  /** SHA-256 der Session-ID; öffentlich verwendbare Kennung (z. B. „Gerät abmelden“) */
  id: string;
  token: string;
}

/**
 * Serverseitige Sitzungen in Redis (S4). Im Cookie steht nur die zufällige Session-ID,
 * in Redis nur deren Hash. Ein Redis-Abzug enthält damit keine verwendbaren Session-IDs.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly crypto: CryptoService,
  ) {}

  private key(id: string) {
    return `sess:${id}`;
  }

  private userKey(userId: string) {
    return `usess:${userId}`;
  }

  private ttlFor(s: StoredSession, now: number): number {
    const idle = s.stage === 'full' ? SESSION_IDLE_SEC : SESSION_PARTIAL_SEC;
    const absoluteLeft = Math.floor((s.createdAt + SESSION_ABSOLUTE_SEC * 1000 - now) / 1000);
    return Math.max(1, Math.min(idle, absoluteLeft));
  }

  async create(userId: string, stage: SessionStage, ip: string, userAgent: string): Promise<ActiveSession> {
    const token = this.crypto.randomToken(32);
    const id = this.crypto.sha256(token);
    const now = Date.now();
    const session: StoredSession = { userId, stage, createdAt: now, lastSeenAt: now, ip, userAgent: userAgent.slice(0, 300) };
    await this.redis
      .multi()
      .set(this.key(id), JSON.stringify(session), 'EX', this.ttlFor(session, now))
      .sadd(this.userKey(userId), id)
      .expire(this.userKey(userId), SESSION_ABSOLUTE_SEC)
      .exec();
    return { ...session, id, token };
  }

  async get(token: string): Promise<ActiveSession | null> {
    if (!token || token.length > 100) return null;
    const id = this.crypto.sha256(token);
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    const now = Date.now();
    if (now - session.createdAt >= SESSION_ABSOLUTE_SEC * 1000) {
      await this.destroyById(session.userId, id);
      return null;
    }
    // Leerlauf-Timeout verlängern; höchstens einmal pro Minute schreiben
    if (now - session.lastSeenAt > 60_000) {
      session.lastSeenAt = now;
      await this.redis.set(this.key(id), JSON.stringify(session), 'EX', this.ttlFor(session, now));
    }
    return { ...session, id, token };
  }

  async update(session: ActiveSession, patch: Partial<StoredSession>): Promise<void> {
    const { id, token: _token, ...stored } = session;
    const next: StoredSession = { ...stored, ...patch };
    await this.redis.set(this.key(id), JSON.stringify(next), 'EX', this.ttlFor(next, Date.now()));
    Object.assign(session, patch);
  }

  /** Neue Session-ID nach jeder Stufe der Anmeldung (Schutz vor Session Fixation, S4). */
  async rotate(session: ActiveSession, stage: SessionStage, ip: string, userAgent: string): Promise<ActiveSession> {
    await this.destroyById(session.userId, session.id);
    return this.create(session.userId, stage, ip, userAgent);
  }

  async destroy(session: ActiveSession): Promise<void> {
    await this.destroyById(session.userId, session.id);
  }

  /** Beendet eine Sitzung, aber nur, wenn sie zu diesem Benutzer gehört. */
  async destroyById(userId: string, id: string): Promise<boolean> {
    if (!(await this.redis.sismember(this.userKey(userId), id))) {
      return false;
    }
    const [[, deleted]] = (await this.redis.multi().del(this.key(id)).srem(this.userKey(userId), id).exec()) as [
      [null, number],
      [null, number],
    ];
    return deleted > 0;
  }

  async listForUser(userId: string): Promise<(StoredSession & { id: string })[]> {
    const ids = await this.redis.smembers(this.userKey(userId));
    if (ids.length === 0) return [];
    const raws = await this.redis.mget(ids.map((id) => this.key(id)));
    const result: (StoredSession & { id: string })[] = [];
    const stale: string[] = [];
    raws.forEach((raw, i) => {
      if (raw) result.push({ ...(JSON.parse(raw) as StoredSession), id: ids[i] });
      else stale.push(ids[i]);
    });
    if (stale.length) await this.redis.srem(this.userKey(userId), ...stale);
    return result.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  /** Beendet alle Sitzungen eines Benutzers, optional außer einer (z. B. der aktuellen). */
  async destroyAllForUser(userId: string, exceptId?: string): Promise<number> {
    const ids = (await this.redis.smembers(this.userKey(userId))).filter((id) => id !== exceptId);
    if (ids.length === 0) return 0;
    await this.redis
      .multi()
      .del(...ids.map((id) => this.key(id)))
      .srem(this.userKey(userId), ...ids)
      .exec();
    return ids.length;
  }
}
