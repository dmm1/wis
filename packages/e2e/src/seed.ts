import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { schema } from '@wis/db';
import { createAuth, createInvitedUser, createPlatformAdmin, provisionTenant } from '@wis/auth';

export const PASSWORD = 'correct-horse-battery-staple';
export const TEST_EMAIL_SUFFIX = '@wis.test';

export interface SeedData {
  platformEmail: string;
  adminEmail: string;
  newbieEmail: string;
  /** Tenant with the work-schedule module; the admin's account already exists. */
  x: { tenantId: string; invitationId: string };
  /** Tenant without modules (same admin, invitation still open). */
  y: { tenantId: string; invitationId: string };
  /** Tenant whose first admin has no account yet (sign-up from invitation). */
  z: { tenantId: string; invitationId: string };
}

function connect() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set');
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  return { pool, db: drizzle(pool, { schema }) };
}

/** The suite creates and deletes data: it must never run where real people exist. */
async function assertOnlyTestData(db: ReturnType<typeof connect>['db']) {
  const res = await db.execute(
    sql`SELECT count(*)::int AS n FROM "user" WHERE email NOT LIKE ${'%' + TEST_EMAIL_SUFFIX}`,
  );
  const n = Number((res.rows[0] as { n: number }).n);
  if (n > 0) {
    throw new Error(
      `Refusing to run: the database contains ${n} user(s) that are not ${TEST_EMAIL_SUFFIX} test accounts. ` +
        'End-to-end tests only run against an empty or test-only database (e.g. the Neon "development" branch).',
    );
  }
}

export async function seed(): Promise<SeedData> {
  const { pool, db } = connect();
  try {
    await assertOnlyTestData(db);
    const mailer = { send: async () => undefined };
    const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
    const auth = createAuth({
      db,
      mailer,
      secret: 'e2e-seed-secret-e2e-seed-secret-e2e-seed',
      baseURL,
      rpID: new URL(baseURL).hostname,
    });
    const run = randomBytes(3).toString('hex');

    const platformEmail = `smoke-platform-${run}${TEST_EMAIL_SUFFIX}`;
    const platform = await createPlatformAdmin(
      { auth, db },
      { email: platformEmail, name: 'Paula Plattform', password: PASSWORD },
    );
    const adminEmail = `smoke-admin-${run}${TEST_EMAIL_SUFFIX}`;
    const newbieEmail = `smoke-newbie-${run}${TEST_EMAIL_SUFFIX}`;
    const common = { baseURL, actorUserId: platform.userId } as const;
    const x = await provisionTenant(
      { db, mailer, baseURL },
      {
        name: 'Café Sonnenschein',
        slug: `smoke-x-${run}`,
        adminEmail,
        maxSeats: 12,
        modules: ['work-schedule'],
        locale: 'de',
        actorUserId: common.actorUserId,
      },
    );
    const y = await provisionTenant(
      { db, mailer, baseURL },
      {
        name: 'Bäckerei Vogl',
        slug: `smoke-y-${run}`,
        adminEmail,
        maxSeats: 40,
        modules: [],
        actorUserId: common.actorUserId,
      },
    );
    const z = await provisionTenant(
      { db, mailer, baseURL },
      {
        name: 'Gasthaus Alm',
        slug: `smoke-z-${run}`,
        adminEmail: newbieEmail,
        maxSeats: 5,
        modules: ['work-schedule'],
        actorUserId: common.actorUserId,
      },
    );
    await createInvitedUser(
      { auth, db },
      { invitationId: x.invitationId, name: 'Anna Admin', password: PASSWORD, locale: 'en' },
    );
    return { platformEmail, adminEmail, newbieEmail, x, y, z };
  } finally {
    await pool.end();
  }
}

/**
 * Removes only what the suite creates: @wis.test users, the smoke customers, the customer created
 * in the platform flow, and audit rows tied to them. The audit log is append-only; deletion uses the
 * documented retention switch inside one transaction.
 */
export async function cleanup(): Promise<{ audit: number; orgs: number; users: number }> {
  const { pool } = connect();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('wis.audit_purge', 'on', true)");
    const testOrgs =
      "SELECT id FROM organization WHERE slug LIKE 'smoke-%' OR slug = 'hotel-edelweiss'";
    const testUsers = `SELECT id FROM "user" WHERE email LIKE '%${TEST_EMAIL_SUFFIX}'`;
    const audit = await client.query(
      `DELETE FROM audit_log WHERE tenant_id IN (${testOrgs}) OR actor_id IN (${testUsers}) OR target_id IN (${testUsers}) OR action IN ('user.created_from_invitation','platform.admin_bootstrapped')`,
    );
    const orgs = await client.query(`DELETE FROM organization WHERE id IN (${testOrgs})`);
    const users = await client.query(`DELETE FROM "user" WHERE email LIKE '%${TEST_EMAIL_SUFFIX}'`);
    await client.query('DELETE FROM rate_limit');
    await client.query('COMMIT');
    return { audit: audit.rowCount ?? 0, orgs: orgs.rowCount ?? 0, users: users.rowCount ?? 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
