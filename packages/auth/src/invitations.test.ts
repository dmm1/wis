import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@wis/db';
import {
  assertTenantActive,
  createAuth,
  createInvitedUser,
  createPlatformAdmin,
  getInvitationPreview,
  getTenantOverview,
  pendingInvitationsFor,
  provisionTenant,
  setTenantStatus,
  TenantErrorCode,
  type Mailer,
} from './index';

const url = process.env.DATABASE_URL;
const PASSWORD = 'correct-horse-battery-staple';

describe.skipIf(!url)('invitation sign-up + tenant gate (integration)', () => {
  const pool = new pg.Pool({ connectionString: url ?? '', max: 4 });
  const db = drizzle(pool, { schema });
  const mailer: Mailer = { send: async () => undefined };
  const baseURL = 'http://localhost:3000';
  const auth = createAuth({
    db,
    secret: 'integration-test-secret-integration-test-secret',
    baseURL,
    rpID: 'localhost',
    mailer,
    restrictSignUp: true,
  });
  const run = randomBytes(4).toString('hex');
  const tenants: string[] = [];
  const invitationIds: string[] = [];
  const emails: string[] = [];
  let platformId = '';

  async function provision(maxSeats = 3) {
    const adminEmail = `inv-${tenants.length}-${run}@wis.test`;
    emails.push(adminEmail);
    const r = await provisionTenant(
      { db, mailer, baseURL },
      {
        name: `Inv ${tenants.length}`,
        slug: `inv${tenants.length}-${run}`,
        adminEmail,
        maxSeats,
        actorUserId: platformId,
      },
    );
    tenants.push(r.tenantId);
    invitationIds.push(r.invitationId);
    return { ...r, adminEmail };
  }

  beforeAll(async () => {
    // platform admin created directly (as the bootstrap script does), since sign-up is closed
    const ctx = await auth.$context;
    const email = `inv-platform-${run}@wis.test`;
    emails.push(email);
    const u = await ctx.internalAdapter.createUser(
      { email, name: 'platform', emailVerified: true, role: 'admin' },
      { method: 'admin' },
    );
    platformId = u.id;
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('wis.audit_purge', 'on', true)`);
      await tx.delete(schema.auditLog).where(inArray(schema.auditLog.tenantId, tenants));
      await tx.execute(
        sql`DELETE FROM audit_log WHERE tenant_id IS NULL AND actor_id = ${platformId}`,
      );
      await tx
        .delete(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, 'user.created_from_invitation'),
            inArray(sql`${schema.auditLog.metadata}->>'invitationId'`, invitationIds),
          ),
        );
    });
    await db.delete(schema.organization).where(inArray(schema.organization.id, tenants));
    await db.delete(schema.user).where(inArray(schema.user.email, emails));
    await pool.end();
  });

  it('closes open e-mail sign-up', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: `open-${run}@wis.test`, password: PASSWORD, name: 'x' },
      }),
    ).rejects.toThrow();
  });

  it('creates a verified account only from a valid invitation, then lets it accept', async () => {
    const r = await provision();
    const preview = await getInvitationPreview(db, r.invitationId);
    expect(preview).toMatchObject({
      state: 'pending',
      email: r.adminEmail,
      role: 'customer-admin',
      accountExists: false,
    });

    await expect(
      createInvitedUser(
        { auth, db },
        { invitationId: 'does-not-exist', name: 'A', password: PASSWORD, locale: 'en' },
      ),
    ).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
    await expect(
      createInvitedUser(
        { auth, db },
        { invitationId: r.invitationId, name: 'A', password: 'short', locale: 'en' },
      ),
    ).rejects.toMatchObject({ code: 'INVITATION_INVALID' });

    const { userId } = await createInvitedUser(
      { auth, db },
      { invitationId: r.invitationId, name: 'Anna Admin', password: PASSWORD, locale: 'de' },
    );
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    expect(u).toMatchObject({ email: r.adminEmail, emailVerified: true, locale: 'de' });

    // the account exists now: a second attempt must not overwrite it
    await expect(
      createInvitedUser(
        { auth, db },
        { invitationId: r.invitationId, name: 'Mallory', password: PASSWORD, locale: 'en' },
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_EXISTS' });
    expect(await getInvitationPreview(db, r.invitationId)).toMatchObject({ accountExists: true });

    // password sign-in works and the invitation can be accepted
    const { headers } = await auth.api.signInEmail({
      body: { email: r.adminEmail, password: PASSWORD },
      returnHeaders: true,
    });
    const h = new Headers({
      cookie: headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    });
    await auth.api.acceptInvitation({ headers: h, body: { invitationId: r.invitationId } });
    expect(await getInvitationPreview(db, r.invitationId)).toMatchObject({ state: 'used' });
  });

  it('bootstraps a platform admin who can sign in, and refuses duplicates', async () => {
    const email = `inv-boot-${run}@wis.test`;
    emails.push(email);
    const { userId } = await createPlatformAdmin(
      { auth, db },
      { email, name: 'Boot', password: PASSWORD },
    );
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    expect(u).toMatchObject({ role: 'admin', emailVerified: true });
    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    ).resolves.toBeTruthy();
    await expect(
      createPlatformAdmin({ auth, db }, { email, name: 'Dup', password: PASSWORD }),
    ).rejects.toThrow(/exists/);
    await expect(
      createPlatformAdmin(
        { auth, db },
        { email: `x-${run}@wis.test`, name: 'W', password: 'short' },
      ),
    ).rejects.toThrow(/at least/);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('wis.audit_purge', 'on', true)`);
      await tx.delete(schema.auditLog).where(eq(schema.auditLog.targetId, userId));
    });
  });

  it('lists open invitations for an e-mail with the workspace name', async () => {
    const r = await provision();
    const open = await pendingInvitationsFor(db, r.adminEmail.toUpperCase());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: r.invitationId, organizationId: r.tenantId });
    expect(open[0]?.organizationName).toMatch(/^Inv /);
    expect(await pendingInvitationsFor(db, 'nobody@wis.test')).toEqual([]);
  });

  it('activates the only workspace on sign-in, but lets people with several choose', async () => {
    const a = await provision();
    const { userId } = await createInvitedUser(
      { auth, db },
      { invitationId: a.invitationId, name: 'Solo', password: PASSWORD, locale: 'en' },
    );
    const signIn = async () => {
      const { headers } = await auth.api.signInEmail({
        body: { email: a.adminEmail, password: PASSWORD },
        returnHeaders: true,
      });
      return new Headers({
        cookie: headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .join('; '),
      });
    };
    const active = async (h: Headers) =>
      (await auth.api.getSession({ headers: h }))?.session.activeOrganizationId ?? null;

    await auth.api.acceptInvitation({
      headers: await signIn(),
      body: { invitationId: a.invitationId },
    });
    expect(await active(await signIn())).toBe(a.tenantId); // one workspace: active from the start

    // a second workspace for the same person
    const b = await provisionTenant(
      { db, mailer, baseURL },
      {
        name: 'Second',
        slug: `inv-second-${run}`,
        adminEmail: a.adminEmail,
        maxSeats: 3,
        actorUserId: platformId,
      },
    );
    tenants.push(b.tenantId);
    invitationIds.push(b.invitationId);
    await auth.api.acceptInvitation({
      headers: await signIn(),
      body: { invitationId: b.invitationId },
    });
    expect(await active(await signIn())).toBeNull(); // several and none used yet: the person chooses

    // choosing is remembered for the next sign-in
    await auth.api.setActiveOrganization({
      headers: await signIn(),
      body: { organizationId: b.tenantId },
    });
    expect(await active(await signIn())).toBe(b.tenantId);
    await auth.api.setActiveOrganization({
      headers: await signIn(),
      body: { organizationId: a.tenantId },
    });
    expect(await active(await signIn())).toBe(a.tenantId);
    expect(userId).toBeTruthy();
  });

  it('reports expired and unknown invitations', async () => {
    const r = await provision();
    await db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitation.id, r.invitationId));
    expect(await getInvitationPreview(db, r.invitationId)).toMatchObject({ state: 'expired' });
    expect(await getInvitationPreview(db, 'nope')).toEqual({ state: 'not_found' });
  });

  it('reports seat usage and blocks suspended tenants at request level', async () => {
    const r = await provision(5);
    const o = await getTenantOverview(db, r.tenantId);
    expect(o).toMatchObject({ status: 'trial', maxSeats: 5, seatsUsed: 0, seatsReserved: 1 });
    await expect(assertTenantActive(db, r.tenantId)).resolves.toMatchObject({
      tenantId: r.tenantId,
    });

    await setTenantStatus(
      { db },
      { tenantId: r.tenantId, status: 'suspended', actorUserId: platformId },
    );
    await expect(assertTenantActive(db, r.tenantId)).rejects.toMatchObject({
      code: TenantErrorCode.TENANT_NOT_ACTIVE,
    });
    await expect(assertTenantActive(db, 'unknown-tenant')).rejects.toMatchObject({
      code: TenantErrorCode.TENANT_NOT_PROVISIONED,
    });
  });
});
