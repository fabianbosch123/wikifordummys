import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, open as openFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { Errors } from '../common/errors';
import { SNIFF_BYTES } from './file-type';

/** Halbe Uploads im tmp-Verzeichnis, die älter sind, stammen aus abgebrochenen Anfragen oder einem Absturz */
const STALE_TMP_MS = 3600 * 1000;

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
export class AttachmentStorageService implements OnModuleInit {
  private readonly logger = new Logger('Anhänge');
  readonly maxBytes: number;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.maxBytes = config.ATTACHMENT_MAX_MB * 1024 * 1024;
  }

  /** Räumt beim Start liegengebliebene halbe Uploads weg; laufende Uploads sind jünger und bleiben */
  async onModuleInit() {
    const removed = await this.removeStaleTmp().catch((err) => {
      this.logger.error(`tmp-Verzeichnis der Anhänge nicht aufgeräumt: ${String(err)}`);
      return 0;
    });
    if (removed) this.logger.log(`${removed} abgebrochene Uploads aus dem tmp-Verzeichnis entfernt`);
  }

  async removeStaleTmp(now = Date.now()): Promise<number> {
    const tmpDir = join(this.config.ATTACHMENTS_DIR, 'tmp');
    const names = await readdir(tmpDir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    let removed = 0;
    for (const name of names) {
      const file = join(tmpDir, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile() && now - info.mtimeMs > STALE_TMP_MS) {
        await rm(file, { force: true });
        removed++;
      }
    }
    return removed;
  }

  private pathOf(storageKey: string): string {
    // Der Schlüssel stammt aus der Datenbank; trotzdem nie einen fremden Pfad zusammensetzen
    if (!KEY_PATTERN.test(storageKey)) throw new Error(`Ungültiger Speicherschlüssel: ${storageKey}`);
    return join(this.config.ATTACHMENTS_DIR, storageKey.slice(0, 2), storageKey);
  }

  /** Freier Platz im Anhang-Verzeichnis in Byte */
  async freeBytes(): Promise<number> {
    await mkdir(this.config.ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
    const fs = await statfs(this.config.ATTACHMENTS_DIR);
    return fs.bavail * fs.bsize;
  }

  /**
   * Wirft 507, wenn nach dem Speichern von `bytes` weniger als ATTACHMENT_MIN_FREE_MB frei blieben (SEC-003).
   * Eine volle Platte hält sonst auch die Datenbank an, die auf demselben Datenträger liegt.
   */
  async assertSpace(bytes: number): Promise<void> {
    const reserve = this.config.ATTACHMENT_MIN_FREE_MB * 1024 * 1024;
    if ((await this.freeBytes()) - bytes < reserve) {
      this.logger.error(`Anhang abgelehnt: weniger als ${this.config.ATTACHMENT_MIN_FREE_MB} MiB frei im Anhang-Verzeichnis`);
      throw Errors.storageFull();
    }
  }

  /**
   * Schreibt den Datenstrom in eine neue Datei; bricht bei Überschreiten der Höchstgröße mit 413 ab.
   * Vorher muss genug Platz frei sein (ohne angekündigte Länge wird mit der Höchstgröße gerechnet).
   */
  async store(input: Readable, declaredLength: number | null = null): Promise<StoredFile> {
    await this.assertSpace(declaredLength ?? this.maxBytes);
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

  /** Liest eine ganze Datei, z. B. eine Zeichnung für den MCP-Server; größere als maxBytes werden abgelehnt */
  async readAll(storageKey: string, maxBytes: number): Promise<Buffer> {
    const file = await openFile(this.pathOf(storageKey), 'r');
    try {
      const { size } = await file.stat();
      if (size > maxBytes) throw Errors.tooLarge(Math.ceil(maxBytes / 1024 / 1024));
      return await file.readFile();
    } finally {
      await file.close();
    }
  }

  /** Liest die ersten Bytes einer Datei, z. B. zur Typprüfung */
  async readHead(storageKey: string, bytes: number): Promise<Buffer> {
    const file = await openFile(this.pathOf(storageKey), 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await file.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
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
