import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
}
