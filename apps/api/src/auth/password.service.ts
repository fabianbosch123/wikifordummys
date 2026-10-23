import { Inject, Injectable } from '@nestjs/common';
import { checkPasswordPolicy } from '@wiki/shared';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { Errors } from '../common/errors';

const charRange = (from: string, to: string) =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i));
/** a-z, A-Z, 2-9 ohne leicht verwechselbare Zeichen (l, I, O; 0 und 1 fehlen ohnehin) */
const START_PASSWORD_ALPHABET = [...charRange('a', 'z'), ...charRange('A', 'Z'), ...charRange('2', '9')]
  .filter((c) => !'lIO'.includes(c))
  .join('');

/** Passwort-Hashing mit Argon2id (S1). Passwörter werden nie geloggt. */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options & { raw?: false };
  private dummyHash: Promise<string> | null = null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.ARGON2_MEMORY_KIB,
      timeCost: config.ARGON2_TIME_COST,
      parallelism: 1,
    };
  }

  assertPolicy(password: string, email?: string): void {
    const problem = checkPasswordPolicy(password, email);
    if (problem) throw Errors.badRequest(problem, 'WEAK_PASSWORD');
  }

  /**
   * Zufälliges Startpasswort zum Abtippen aus der Shell: 4 Blöcke à 5 Zeichen ohne
   * leicht verwechselbare Zeichen (0/O, 1/l/I), rund 115 Bit Zufall.
   */
  generate(): string {
    const blocks = Array.from({ length: 4 }, () =>
      Array.from({ length: 5 }, () => START_PASSWORD_ALPHABET[randomInt(START_PASSWORD_ALPHABET.length)]).join(''),
    );
    return blocks.join('-');
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * Prüft gegen einen Platzhalter-Hash, wenn es das Konto nicht gibt,
   * damit die Antwortzeit nichts über die Existenz verrät (S10).
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('platzhalter-fuer-unbekannte-konten');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
