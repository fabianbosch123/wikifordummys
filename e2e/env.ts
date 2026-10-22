/** Umgebung für API und Weboberfläche während der Ende-zu-Ende-Tests */
export const e2eEnv: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3001',
  APP_ORIGIN: 'http://localhost:3100',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://wiki:wiki@localhost:5432/wiki_e2e',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14',
  ENCRYPTION_KEY: '1'.repeat(64),
  SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
  COOKIE_SECURE: 'false',
  TRUST_PROXY: '1',
  // Muss zur Adresse passen, mit der die Weboberfläche gebaut wurde (Standard)
  API_INTERNAL_URL: 'http://localhost:3001',
};
