import { defineConfig } from 'prisma/config';
import { loadEnvFile } from './config/loadEnv';

loadEnvFile();

export default defineConfig({
  schema: 'prisma/schema',
  seed: 'ts-node --transpile-only prisma/seed.ts',
});
