import 'server-only';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { consoleMailer, createAuth, createResendMailer, type Auth, type Mailer } from '@wis/auth';
import { createDb, createPool, schema, type Db } from '@wis/db';
import { serverEnv } from './env';

interface AuthContext {
  auth: Auth;
  /** Owner connection for auth-layer reads (auth tables are not tenant-scoped). */
  db: NodePgDatabase<typeof schema>;
  /** Tenant-scoped access: always use through withTenant() (runs as the restricted wis_app role). */
  appDb: Db;
  mailer: Mailer;
  baseURL: string;
}

// Survive Next.js dev hot reloads without leaking pools.
const globalForAuth = globalThis as unknown as { __wisAuth?: AuthContext };

function build(): AuthContext {
  const env = serverEnv();
  const pool = createPool(env.DATABASE_URL, 10);
  const db = drizzle(pool, { schema });
  // Resend when configured (required in production). MAIL_TRANSPORT=console forces the console
  // mailer, e.g. for end-to-end tests that must never send real e-mail.
  const mailer =
    env.MAIL_TRANSPORT !== 'console' && env.RESEND_API_KEY && env.MAIL_FROM
      ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM })
      : undefined;
  const auth = createAuth({
    db,
    ...(mailer ? { mailer } : {}),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    rpID: new URL(env.BETTER_AUTH_URL).hostname,
    production: env.APP_ENV === 'production' && env.MAIL_TRANSPORT !== 'console',
    restrictSignUp: true, // accounts only come from invitations or the platform admin
  });
  return {
    auth,
    db,
    appDb: createDb(pool),
    mailer: mailer ?? consoleMailer,
    baseURL: env.BETTER_AUTH_URL,
  };
}

export function getAuthContext(): AuthContext {
  globalForAuth.__wisAuth ??= build();
  return globalForAuth.__wisAuth;
}

export const getAuth = () => getAuthContext().auth;
