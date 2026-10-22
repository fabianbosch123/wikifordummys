import { defineConfig, devices } from '@playwright/test';
import { e2eEnv } from './env';

/**
 * Startet API und Weboberfläche (vorher `pnpm build`) gegen eine eigene Datenbank wiki_e2e.
 * Voraussetzung: PostgreSQL und Redis laufen lokal (oder als Dienste in der CI).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Migrationen sind nicht destruktiv; Tests nutzen eindeutige E-Mail-Adressen
      command: 'pnpm --dir ../apps/api exec prisma migrate deploy && node ../apps/api/dist/main.js',
      url: 'http://localhost:3001/api/v1/health',
      env: e2eEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --dir ../apps/web exec next start -p 3100',
      url: 'http://localhost:3100/login',
      env: e2eEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
