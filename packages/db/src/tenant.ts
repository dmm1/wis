import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

export type Db = NodePgDatabase;

/** Pool for the app (pooled Neon endpoint). SSL mode comes from the connection string. */
export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool);
}

/** The restricted role every tenant-scoped transaction runs as. It has no BYPASSRLS. */
export const APP_ROLE = 'wis_app';

const TENANT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs `fn` in a transaction scoped to one tenant.
 *
 * - `SET LOCAL ROLE wis_app` drops the owner's BYPASSRLS so policies apply.
 * - `app.tenant_id` is set transaction-locally, which is safe with PgBouncer
 *   transaction pooling (a plain SET would leak to the next client).
 * Both settings vanish on commit/rollback.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!TENANT_ID.test(tenantId)) throw new Error('Invalid tenant id');
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
