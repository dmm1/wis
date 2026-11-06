import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load the monorepo-root env for integration tests (Node built-in, no dependency).
// `.env.local` wins over `.env`, like Next.js. Already-set variables are never overridden.
for (const name of ['.env.local', '.env']) {
  const path = fileURLToPath(new URL(`../../../${name}`, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
