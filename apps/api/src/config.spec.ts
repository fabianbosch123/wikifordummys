import { isWeakSecret, loadConfig } from "./config";

const production = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://wiki.example.de",
  DATABASE_URL: "postgresql://wiki@db/wiki",
  REDIS_URL: "redis://redis:6379",
  ENCRYPTION_KEY:
    "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  SESSION_SECRET:
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
};

describe("Konfiguration", () => {
  it("nimmt zufällige Geheimnisse in Produktion an", () => {
    expect(loadConfig(production).SESSION_SECRET).toBe(
      production.SESSION_SECRET,
    );
    expect(() =>
      loadConfig({
        ...production,
        OFFICE_ENABLED: "true",
        OFFICE_JWT_SECRET: production.ENCRYPTION_KEY,
      }),
    ).not.toThrow();
  });

  it("lehnt in Produktion den Platzhalter aus .env.example ab", () => {
    expect(() =>
      loadConfig({
        ...production,
        SESSION_SECRET: "bitte-mit-openssl-rand-hex-32-ersetzen",
      }),
    ).toThrow(/SESSION_SECRET: Platzhalter/);
    expect(() =>
      loadConfig({
        ...production,
        OFFICE_ENABLED: "true",
        OFFICE_JWT_SECRET: "bitte-mit-openssl-rand-hex-32-ersetzen",
      }),
    ).toThrow(/OFFICE_JWT_SECRET: Platzhalter/);
  });

  it("lehnt in Produktion Testwerte ab", () => {
    for (const value of [
      "test-secret-test-secret-test-secret-123",
      "e2e-secret-e2e-secret-e2e-secret-1234",
      "jwt-test-secret-jwt-test-secret-jwt-test",
      "0".repeat(64),
    ]) {
      expect(isWeakSecret(value)).toBe(true);
      expect(() =>
        loadConfig({ ...production, SESSION_SECRET: value }),
      ).toThrow(/SESSION_SECRET/);
    }
  });

  it("lässt Testwerte außerhalb der Produktion zu", () => {
    expect(() =>
      loadConfig({
        ...production,
        NODE_ENV: "development",
        SESSION_SECRET: "test-secret-test-secret-test-secret-123",
      }),
    ).not.toThrow();
  });
});
