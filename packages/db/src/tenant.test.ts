import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool, withTenant, type Db } from './tenant';
import { runMigrations } from './migrate';

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const enabled = Boolean(pooledUrl && directUrl);

// Integration test against Neon: uses a throwaway schema, dropped afterwards.
describe.skipIf(!enabled)('withTenant (row level security)', () => {
  const schema = `rls_test_${randomBytes(4).toString('hex')}`;
  const pool = createPool(pooledUrl ?? '', 4);
  const db: Db = createDb(pool);

  beforeAll(async () => {
    await runMigrations(directUrl ?? '');
    await db.execute(sql.raw(`CREATE SCHEMA ${schema}`));
    await db.execute(sql.raw(`GRANT USAGE ON SCHEMA ${schema} TO wis_app`));
    await db.execute(
      sql.raw(`CREATE TABLE ${schema}.item (
        id serial PRIMARY KEY,
        tenant_id text NOT NULL,
        name text NOT NULL
      )`),
    );
    await db.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.item TO wis_app`));
    await db.execute(sql.raw(`GRANT USAGE ON SEQUENCE ${schema}.item_id_seq TO wis_app`));
    await db.execute(sql.raw(`ALTER TABLE ${schema}.item ENABLE ROW LEVEL SECURITY`));
    await db.execute(
      sql.raw(`CREATE POLICY tenant_isolation ON ${schema}.item
        USING (tenant_id = app_tenant_id())
        WITH CHECK (tenant_id = app_tenant_id())`),
    );
  });

  afterAll(async () => {
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
    await pool.end();
  });

  const item = sql.raw(`${schema}.item`);

  it('isolates rows between tenants', async () => {
    await withTenant(db, 'tenant-a', (tx) =>
      tx.execute(sql`INSERT INTO ${item} (tenant_id, name) VALUES ('tenant-a', 'a1')`),
    );
    await withTenant(db, 'tenant-b', (tx) =>
      tx.execute(sql`INSERT INTO ${item} (tenant_id, name) VALUES ('tenant-b', 'b1')`),
    );

    const a = await withTenant(db, 'tenant-a', (tx) => tx.execute(sql`SELECT name FROM ${item}`));
    const b = await withTenant(db, 'tenant-b', (tx) => tx.execute(sql`SELECT name FROM ${item}`));
    expect(a.rows).toEqual([{ name: 'a1' }]);
    expect(b.rows).toEqual([{ name: 'b1' }]);
  });

  it('rejects writing a row for another tenant (WITH CHECK)', async () => {
    await expect(
      withTenant(db, 'tenant-a', (tx) =>
        tx.execute(sql`INSERT INTO ${item} (tenant_id, name) VALUES ('tenant-b', 'evil')`),
      ),
    ).rejects.toThrow();
  });

  it('cannot update or delete another tenant’s rows', async () => {
    const upd = await withTenant(db, 'tenant-a', (tx) =>
      tx.execute(sql`UPDATE ${item} SET name = 'hacked' WHERE tenant_id = 'tenant-b'`),
    );
    const del = await withTenant(db, 'tenant-a', (tx) =>
      tx.execute(sql`DELETE FROM ${item} WHERE tenant_id = 'tenant-b'`),
    );
    expect(upd.rowCount).toBe(0);
    expect(del.rowCount).toBe(0);
  });

  it('fails closed when no tenant is set', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE wis_app'));
      return tx.execute(sql`SELECT name FROM ${item}`);
    });
    expect(rows.rows).toEqual([]);
  });

  it('does not leak tenant context or role to later pooled transactions', async () => {
    await withTenant(db, 'tenant-a', (tx) => tx.execute(sql`SELECT 1`));
    const res = await db.execute(
      sql`SELECT current_user AS u, current_setting('app.tenant_id', true) AS t`,
    );
    expect(res.rows[0]?.u).not.toBe('wis_app');
    expect(res.rows[0]?.t ?? '').toBe('');
  });

  it('is protected from the owner role only by switching role (documents the pitfall)', async () => {
    const owner = await db.execute(sql`SELECT count(*)::int AS n FROM ${item}`);
    expect(owner.rows[0]?.n).toBeGreaterThanOrEqual(2); // owner bypasses RLS
  });

  it('rejects malformed tenant ids', async () => {
    await expect(withTenant(db, "x'; DROP TABLE y;--", async () => 1)).rejects.toThrow(
      'Invalid tenant id',
    );
    await expect(withTenant(db, '', async () => 1)).rejects.toThrow('Invalid tenant id');
  });
});
