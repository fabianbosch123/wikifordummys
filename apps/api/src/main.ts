import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT, '0.0.0.0');
  new Logger('API').log(`wikifordummys-API läuft auf Port ${config.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
