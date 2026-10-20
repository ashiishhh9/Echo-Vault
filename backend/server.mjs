import { createApp } from './src/app.mjs';

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(envFile) && process.loadEnvFile) process.loadEnvFile(envFile);

const app = createApp();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
app.server.listen(port, host, () => {
  console.log(`Digital Time Capsule API and web app listening on ${host}:${port}`);
});

const shutdown = () => app.close().finally(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
