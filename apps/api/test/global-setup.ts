import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://wiki:wiki@localhost:5432/wiki_test';
  // Legt die Testdatenbank bei Bedarf an und spielt ausstehende Migrationen ein.
  // Die Tests leeren die Tabellen selbst (siehe resetState in helpers.ts).
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
