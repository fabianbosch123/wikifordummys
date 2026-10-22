import { authenticator } from 'otplib';
import { loadConfig } from '../config';
import { CryptoService } from '../infra/crypto.service';
import { TotpService } from './totp.service';

describe('TotpService (S2)', () => {
  const totp = new TotpService(new CryptoService(loadConfig()));

  it('erkennt gültige Codes und liefert den Zeitschritt', () => {
    const secret = totp.generateSecret();
    const step = totp.matchStep(authenticator.generate(secret), secret);
    expect(step).toBe(Math.floor(Date.now() / 30_000));
  });

  it('lehnt falsche und fehlerhaft formatierte Codes ab', () => {
    const secret = totp.generateSecret();
    expect(totp.matchStep('000000', secret) === null || authenticator.generate(secret) === '000000').toBe(true);
    expect(totp.matchStep('12345', secret)).toBeNull();
    expect(totp.matchStep('abcdef', secret)).toBeNull();
  });

  it('erzeugt 10 verschiedene Wiederherstellungscodes', () => {
    const codes = totp.generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it('hasht Wiederherstellungscodes unabhängig von Schreibweise', () => {
    expect(totp.hashRecoveryCode('abcd-efgh-jkmn')).toBe(totp.hashRecoveryCode(' ABCD EFGH JKMN '));
    expect(totp.hashRecoveryCode('abcd-efgh-jkmn')).not.toContain('abcd');
  });

  it('liefert QR-Code und otpauth-URL für die Einrichtung', async () => {
    const data = await totp.setupData(totp.generateSecret(), 'anna@example.de');
    expect(data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/wikifordummys:anna%40example\.de\?secret=/);
    expect(data.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
