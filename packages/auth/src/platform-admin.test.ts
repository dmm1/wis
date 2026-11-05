import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@wis/db';
import {
  assertModuleEnabled,
  createAuth,
  createPlatformAdmin,
  getTenantDetail,
  listTenants,
  provisionTenant,
  resendInvitation,
  setTenantStatus,
  TenantErrorCode,
  tenantRoles,
  updateTenantEntitlements,
  type MailMessage,
} from './index';

describe('roles derived from module manifests', () => {
  it('grants module permissions per manifest', () => {
    const can = (role: keyof typeof tenantRoles, perm: Record<string, string[]>) =>
      tenantRoles[role].authorize(perm as never).success;
    expect(can('planner', { 'work-schedule': ['write'] })).toBe(true);
    expect(can('planner', { 'work-schedule': ['approve'] })).toBe(false);
    expect(can('team-lead', { 'work-schedule': ['approve'] })).toBe(true);
    expect(can('employee', { 'work-schedule': ['read'] })).toBe(true);
    expect(can('employee', { 'work-schedule': ['write'] })).toBe(false);
    expect(can('customer-admin', { 'work-schedule': ['publish'] })).toBe(true);
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('platform administration (integration)', () => {
  const pool = new pg.Pool({ connectionString: url ?? '', max: 4 });
  const db = drizzle(pool, { schema });
  const sent: MailMessage[] = [];
  const mailer = { send: async (m: MailMessage) => void sent.push(m) };
  const baseURL = 'http://localhost:3000';
  const auth = createAuth({
    db,
    secret: 'integration-test-secret-integration-test-secret',
    baseURL,
    rpID: 'localhost',
    mailer,
    restrictSignUp: true,
  });
  const run = randomBytes(3).toString('hex');
  const tenants: string[] = [];
  const emails: string[] = [];
  let actor = '';
  let n = 0;

  async function provision(opts: { maxSeats?: number; modules?: string[]; name?: string } = {}) {
    const adminEmail = `pa-${n}-${run}@wis.test`;
    emails.push(adminEmail);
    const r = await provisionTenant(
      { db, mailer, baseURL },
      {
        name: opts.name ?? `Tenant PA ${n}`,
        slug: `pa${n++}-${run}`,
        adminEmail,
        maxSeats: opts.maxSeats ?? 5,
        modules: opts.modules ?? [],
        actorUserId: actor,
      },
    );
    tenants.push(r.tenantId);
    return r;
  }

  beforeAll(async () => {
    const email = `pa-actor-${run}@wis.test`;
    emails.push(email);
    actor = (
      await createPlatformAdmin(
        { auth, db },
        { email, name: 'Actor', password: 'correct-horse-battery-staple' },
      )
    ).userId;
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('wis.audit_purge', 'on', true)`);
      await tx.delete(schema.auditLog).where(inArray(schema.auditLog.tenantId, tenants));
      await tx.delete(schema.auditLog).where(eq(schema.auditLog.actorId, actor));
      await tx.delete(schema.auditLog).where(eq(schema.auditLog.targetId, actor));
    });
    await db.delete(schema.organization).where(inArray(schema.organization.id, tenants));
    await db.delete(schema.user).where(inArray(schema.user.email, emails));
    await pool.end();
  });

  it('lists tenants with seat usage and modules, with search and status filters', async () => {
    const a = await provision({
      name: `Alpine Bakery ${run}`,
      modules: ['work-schedule'],
      maxSeats: 8,
    });
    const b = await provision({ name: `Baltic Cafe ${run}` });
    await setTenantStatus(
      { db },
      { tenantId: b.tenantId, status: 'suspended', actorUserId: actor },
    );

    const found = await listTenants(db, { search: `Alpine Bakery ${run}` });
    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({
      id: a.tenantId,
      status: 'trial',
      maxSeats: 8,
      seatsUsed: 0,
      seatsReserved: 1,
      modules: ['work-schedule'],
    });
    const suspended = await listTenants(db, { search: run, status: 'suspended' });
    expect(suspended.items.map((t) => t.id)).toEqual([b.tenantId]);
    // wildcard characters in the search are literal
    expect(
      (await listTenants(db, { search: '%' })).items.every(
        (t) => t.name.includes('%') || t.slug.includes('%'),
      ),
    ).toBe(true);
  });

  it('returns tenant detail with invitations and activity', async () => {
    const r = await provision({ modules: ['work-schedule'] });
    const d = await getTenantDetail(db, r.tenantId);
    expect(d).toMatchObject({
      status: 'trial',
      modules: ['work-schedule'],
      seatsUsed: 0,
      seatsReserved: 1,
    });
    expect(d?.invitations).toHaveLength(1);
    expect(d?.activity.map((x) => x.action)).toContain('tenant.provisioned');
    expect(await getTenantDetail(db, 'nope')).toBeNull();
  });

  it('changes seats and modules safely, audited', async () => {
    const r = await provision({ maxSeats: 3 });
    await updateTenantEntitlements(db, {
      tenantId: r.tenantId,
      maxSeats: 10,
      modules: ['work-schedule'],
      actorUserId: actor,
    });
    let d = await getTenantDetail(db, r.tenantId);
    expect(d).toMatchObject({ maxSeats: 10, modules: ['work-schedule'] });

    // 1 reserved seat (open invitation): can't go below usage
    await expect(
      updateTenantEntitlements(db, {
        tenantId: r.tenantId,
        maxSeats: 0 as never,
        actorUserId: actor,
      }),
    ).rejects.toThrow();
    await db.insert(schema.invitation).values({
      id: `extra-${run}-${n}`,
      organizationId: r.tenantId,
      email: `extra-${run}@wis.test`,
      role: 'employee',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3_600_000),
      inviterId: actor,
    });
    await expect(
      updateTenantEntitlements(db, { tenantId: r.tenantId, maxSeats: 1, actorUserId: actor }),
    ).rejects.toMatchObject({ code: TenantErrorCode.SEATS_BELOW_USAGE });

    await expect(
      updateTenantEntitlements(db, {
        tenantId: r.tenantId,
        modules: ['made-up'],
        actorUserId: actor,
      }),
    ).rejects.toMatchObject({ code: TenantErrorCode.UNKNOWN_MODULE });

    await updateTenantEntitlements(db, { tenantId: r.tenantId, modules: [], actorUserId: actor });
    d = await getTenantDetail(db, r.tenantId);
    expect(d?.modules).toEqual([]);
    const actions = (
      await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, r.tenantId))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['tenant.seats_changed', 'tenant.modules_changed']),
    );
  });

  it('gates module access on entitlements and tenant status', async () => {
    const r = await provision({ modules: ['work-schedule'] });
    await expect(assertModuleEnabled(db, r.tenantId, 'work-schedule')).resolves.toMatchObject({
      tenantId: r.tenantId,
    });
    await expect(assertModuleEnabled(db, r.tenantId, 'absences')).rejects.toMatchObject({
      code: TenantErrorCode.MODULE_NOT_ENABLED,
    });
    await setTenantStatus(
      { db },
      { tenantId: r.tenantId, status: 'suspended', actorUserId: actor },
    );
    await expect(assertModuleEnabled(db, r.tenantId, 'work-schedule')).rejects.toMatchObject({
      code: TenantErrorCode.TENANT_NOT_ACTIVE,
    });
  });

  it('resends a pending invitation with a fresh expiry, and refuses others', async () => {
    const r = await provision();
    sent.length = 0;
    await db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() + 1000) })
      .where(eq(schema.invitation.id, r.invitationId));
    await expect(
      resendInvitation(
        { db, mailer, baseURL },
        { invitationId: r.invitationId, actorUserId: actor },
      ),
    ).resolves.toEqual({
      emailSent: true,
    });
    const [inv] = await db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.id, r.invitationId));
    expect(inv!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    expect(sent[0]?.text).toContain(`/accept-invitation/${r.invitationId}`);

    await db
      .update(schema.invitation)
      .set({ status: 'canceled' })
      .where(and(eq(schema.invitation.id, r.invitationId)));
    await expect(
      resendInvitation(
        { db, mailer, baseURL },
        { invitationId: r.invitationId, actorUserId: actor },
      ),
    ).rejects.toMatchObject({ code: TenantErrorCode.INVITATION_NOT_PENDING });
  });
});
