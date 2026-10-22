import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { CryptoService } from '../infra/crypto.service';

authenticator.options = { window: 1, step: 30, digits: 6 };

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** TOTP und Wiederherstellungscodes (S2). */
@Injectable()
export class TotpService {
  constructor(private readonly crypto: CryptoService) {}

  generateSecret(): string {
    return authenticator.generateSecret(20);
  }

  async setupData(secret: string, email: string) {
    const otpauthUrl = authenticator.keyuri(email, 'wikifordummys', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    return { secret, otpauthUrl, qrDataUrl };
  }

  /**
   * Liefert den Zeitschritt des passenden Codes oder null.
   * Der Aufrufer speichert den Schritt, damit derselbe Code nicht erneut gilt.
   */
  matchStep(code: string, secret: string, now = Date.now()): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    // Fester Zeitpunkt, damit Prüfung und berechneter Zeitschritt zusammenpassen
    const delta = authenticator.clone({ epoch: now }).checkDelta(code, secret);
    if (delta === null) return null;
    return Math.floor(now / 1000 / 30) + delta;
  }

  /** 10 Codes im Format xxxx-xxxx-xxxx (ca. 59 Bit Zufall je Code) */
  generateRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
      const bytes = randomBytes(12);
      const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
      return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
    });
  }

  normalizeRecoveryCode(code: string): string {
    return code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  hashRecoveryCode(code: string): string {
    return this.crypto.hmac(`recovery:${this.normalizeRecoveryCode(code)}`);
  }
}
