import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Testumgebung: eigene Datenbank und eigene Redis-DB, damit Entwicklungsdaten unberührt bleiben
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN ??= 'http://wiki.test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://wiki:wiki@localhost:5432/wiki_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.COOKIE_SECURE ??= 'false';
process.env.TRUST_PROXY ??= '1';
// Argon2 in Tests schneller, Parameter in Produktion siehe config.ts
process.env.ARGON2_MEMORY_KIB ??= '4096';
process.env.ARGON2_TIME_COST ??= '1';
// Anhänge in ein temporäres Verzeichnis; kleine Höchstgröße, damit der Test des Limits schnell ist
process.env.ATTACHMENTS_DIR ??= join(tmpdir(), 'wiki-test-attachments');
process.env.ATTACHMENT_MAX_MB ??= '1';
// Platzreserve in Tests aus, der Datenträger der Sandbox ist klein
process.env.ATTACHMENT_MIN_FREE_MB ??= '0';
