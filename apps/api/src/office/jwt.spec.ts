import { signJwt, verifyJwt } from './jwt';

const SECRET = 'jwt-test-secret-jwt-test-secret-jwt-test';

describe('JWT (HS256)', () => {
  it('prüft Signatur und Ablaufzeit', () => {
    const now = Date.UTC(2026, 9, 23, 12);
    const token = signJwt({ att: 'x' }, SECRET, 60, now);
    expect(verifyJwt(token, SECRET, now + 59_000)).toMatchObject({ att: 'x', exp: now / 1000 + 60 });
    expect(verifyJwt(token, SECRET, now + 61_000)).toBeNull();
    expect(verifyJwt(token, `${SECRET}x`, now)).toBeNull();
    // Ohne Ablaufzeit gilt das Token unbefristet (so signiert der Editor-Server seine Rückrufe)
    expect(verifyJwt(signJwt({ key: 'k' }, SECRET), SECRET)).toEqual({ key: 'k' });
  });

  it('lehnt veränderte Inhalte und andere Algorithmen ab', () => {
    const [header, , sig] = signJwt({ status: 2 }, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ status: 6 })).toString('base64url');
    expect(verifyJwt(`${header}.${forged}.${sig}`, SECRET)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyJwt(`${none}.${forged}.`, SECRET)).toBeNull();
    expect(verifyJwt('kein-token', SECRET)).toBeNull();
  });
});
