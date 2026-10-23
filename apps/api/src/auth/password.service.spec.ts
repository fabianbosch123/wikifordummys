import { checkPasswordPolicy } from '@wiki/shared';
import { loadConfig } from '../config';
import { PasswordService } from './password.service';

describe('Passwörter (S1)', () => {
  const service = new PasswordService(loadConfig());

  it('hasht mit Argon2id und ohne Klartext', async () => {
    const hash = await service.hash('korrektes-pferd-batterie');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('korrektes');
    expect(await service.verify(hash, 'korrektes-pferd-batterie')).toBe(true);
    expect(await service.verify(hash, 'falsch-falsch-falsch')).toBe(false);
  });

  it('verlangt mindestens 12 Zeichen', () => {
    expect(checkPasswordPolicy('kurz-123')).toMatch(/mindestens 12/);
    expect(checkPasswordPolicy('genau-12-zei')).toBeNull();
    expect(checkPasswordPolicy('x'.repeat(257))).toMatch(/höchstens/);
    expect(checkPasswordPolicy('            ')).toMatch(/Leerzeichen/);
    expect(checkPasswordPolicy('anna@example.de', 'anna@example.de')).toMatch(/E-Mail/);
  });

  it('erzeugt lesbare, zufällige Startpasswörter, die die Richtlinie erfüllen', () => {
    const a = service.generate();
    expect(a).toMatch(/^[a-zA-Z2-9]{5}(-[a-zA-Z2-9]{5}){3}$/);
    expect(a).not.toMatch(/[01lIO]/);
    expect(checkPasswordPolicy(a)).toBeNull();
    expect(service.generate()).not.toBe(a);
  });

  it('wirft bei schwachem Passwort einen 400-Fehler', () => {
    expect(() => service.assertPolicy('zu-kurz')).toThrow();
  });

  it('liefert für unbekannte Konten false, nach gleicher Arbeit (S10)', async () => {
    expect(await service.verifyDummy('irgendwas')).toBe(false);
  });
});
