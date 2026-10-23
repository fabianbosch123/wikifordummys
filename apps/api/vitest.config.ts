import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC erzeugt die Decorator-Metadaten, die NestJS für Dependency Injection braucht
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/env.ts'],
    // Integrationstests teilen sich Datenbank und Redis
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
