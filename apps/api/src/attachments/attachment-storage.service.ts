import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { Errors } from '../common/errors';
import { SNIFF_BYTES } from './file-type';

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class TooLargeError extends Error {}

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  /** Die ersten Bytes zur Typerkennung */
  head: Buffer;
}

/**
 * Ablage der Anhänge im Dateisystem (S7): außerhalb des Web-Roots, unter zufälligem Namen,
 * nur für die API lesbar. Der Original-Dateiname steht ausschließlich in der Datenbank.
 */
@Injectable()
export class AttachmentStorageService {
  private readonly logger = new Logger('Anhänge');
  readonly maxBytes: number;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.maxBytes = config.ATTACHMENT_MAX_MB * 1024 * 1024;
  }

  private pathOf(storageKey: string): string {
    // Der Schlüssel stammt aus der Datenbank; trotzdem nie einen fremden Pfad zusammensetzen
    if (!KEY_PATTERN.test(storageKey)) throw new Error(`Ungültiger Speicherschlüssel: ${storageKey}`);
    return join(this.config.ATTACHMENTS_DIR, storageKey.slice(0, 2), storageKey);
  }

  /** Schreibt den Datenstrom in eine neue Datei; bricht bei Überschreiten der Höchstgröße mit 413 ab */
  async store(input: Readable): Promise<StoredFile> {
    const storageKey = randomUUID();
    const tmpDir = join(this.config.ATTACHMENTS_DIR, 'tmp');
    const tmp = join(tmpDir, storageKey);
    await mkdir(tmpDir, { recursive: true, mode: 0o700 });

    const hash = createHash('sha256');
    let sizeBytes = 0;
    let head = Buffer.alloc(0);
    const maxBytes = this.maxBytes;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) return done(new TooLargeError());
        hash.update(chunk);
        if (head.length < SNIFF_BYTES) head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
        done(null, chunk);
      },
    });

    try {
      await pipeline(input, meter, createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
      const target = this.pathOf(storageKey);
      await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      if (err instanceof TooLargeError) throw Errors.tooLarge(this.config.ATTACHMENT_MAX_MB);
      throw err;
    }
    return { storageKey, sizeBytes, sha256: hash.digest('hex'), head };
  }

  open(storageKey: string): ReadStream {
    return createReadStream(this.pathOf(storageKey));
  }

  /** Löscht Dateien; fehlende Dateien sind kein Fehler */
  async remove(storageKeys: string[]): Promise<void> {
    for (const key of storageKeys) {
      try {
        await rm(this.pathOf(key), { force: true });
      } catch (err) {
        this.logger.error(`Anhang ${key} konnte nicht gelöscht werden: ${String(err)}`);
      }
    }
  }
}
