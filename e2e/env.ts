/** Umgebung für API und Weboberfläche während der Ende-zu-Ende-Tests */
export const e2eEnv: Record<string, string> = {
  // Gilt für API und `next start`. Der Build der Weboberfläche setzt selbst NODE_ENV=production (apps/web/package.json),
  // weil `next build` mit development an der Fehlerseite /404 abbricht („<Html> should not be imported …“)
  NODE_ENV: 'development',
  PORT: '3001',
  APP_ORIGIN: 'http://localhost:3100',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://wiki:wiki@localhost:5432/wiki_e2e',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14',
  ENCRYPTION_KEY: '1'.repeat(64),
  SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
  COOKIE_SECURE: 'false',
  TRUST_PROXY: '1',
  // Alle Tests laufen von derselben Adresse und legen ihre Admins meist per Einladung an; das Limit von 30 je Stunde reicht dafür nicht
  RATE_INVITE_PER_HOUR: '1000',
  ATTACHMENTS_DIR: process.env.E2E_ATTACHMENTS_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/wiki-e2e-attachments`,
  // Office-Editor: tests/office.spec.ts ersetzt Editor-Skript und Editor-Server durch Attrappen
  OFFICE_ENABLED: 'true',
  OFFICE_JWT_SECRET: 'e2e-office-secret-e2e-office-secret-1234',
  OFFICE_INTERNAL_URL: 'http://localhost:3990',
  OFFICE_API_URL: 'http://localhost:3001',
  // draw.io: tests/drawio.spec.ts ersetzt /draw/ durch eine Attrappe
  DRAWIO_ENABLED: 'true',
  // Muss zur Adresse passen, mit der die Weboberfläche gebaut wurde (Standard)
  API_INTERNAL_URL: 'http://localhost:3001',
};
