// Usage: pnpm --filter @wis/auth create-platform-admin you@example.com "Your Name"
// Password: set PLATFORM_ADMIN_PASSWORD, otherwise a strong one is generated and shown once.
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from '@wis/db';
import { createAuth, createPlatformAdmin } from '../src/index';

const [email, name = ''] = process.argv.slice(2);
if (!email) {
  console.error('Usage: create-platform-admin <email> [name]');
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set');

const generated = !process.env.PLATFORM_ADMIN_PASSWORD;
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const db = drizzle(pool, { schema });
  const auth = createAuth({
    db,
    secret: process.env.BETTER_AUTH_SECRET ?? 'bootstrap-script-secret-not-used-for-sessions',
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    rpID: new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').hostname,
  });
  const { userId } = await createPlatformAdmin({ auth, db }, { email, name, password });
  console.log(`Platform admin created: ${email} (${userId})`);
  if (generated)
    console.log(`Generated password (shown once, change it after first sign-in): ${password}`);
} finally {
  await pool.end();
}
