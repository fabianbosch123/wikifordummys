import { loadConfig } from '../config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const crypto = new CryptoService(loadConfig());

  it('verschlüsselt mit AES-256-GCM und entschlüsselt wieder (S2)', () => {
    const encrypted = crypto.encrypt('JBSWY3DPEHPK3PXP');
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(crypto.decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('nutzt für jede Verschlüsselung einen neuen IV', () => {
    expect(crypto.encrypt('x')).not.toBe(crypto.encrypt('x'));
  });

  it('erkennt manipulierte Daten', () => {
    const [v, iv, tag, data] = crypto.encrypt('geheim').split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => crypto.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('lehnt Schlüssel mit falscher Länge ab', () => {
    expect(() => new CryptoService({ ...loadConfig(), ENCRYPTION_KEY: 'a'.repeat(40) })).toThrow(/32 Byte/);
  });
});
