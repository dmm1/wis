import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool, schema, withTenant } from '@wis/db';
import {
  canTransition,
  createAuth,
  provisionTenant,
  setTenantStatus,
  TenantErrorCode,
  type Mailer,
  type MailMessage,
} from './index';

const url = process.env.DATABASE_URL;
const enabled = Boolean(url);
const PASSWORD = 'correct-horse-battery-staple';

// Integration tests against the Neon `development` branch. All rows are removed afterwards.
describe.skipIf(!enabled)('auth + tenancy (integration)', () => {
  const pool: pg.Pool = new pg.Pool({ connectionString: url ?? '', max: 8 });
  const db = drizzle(pool, { schema });
  const sent: MailMessage[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const baseURL = 'http://localhost:3000';
  const auth = createAuth({
    db,
    secret: 'integration-test-secret-integration-test-secret',
    baseURL,
    rpID: 'localhost',
    mailer,
  });

  const run = randomBytes(4).toString('hex');
  const createdUsers: string[] = [];
  const createdTenants: string[] = [];

  async function signUp(label: string) {
    const email = `${label}-${run}@wis.test`;
    const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
    createdUsers.push(res.user.id);
    return { id: res.user.id, email };
  }

  async function headersFor(email: string) {
    const { headers } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    return new Headers({
      cookie: headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    });
  }

  let platform: { id: string; email: string };
  let slugCounter = 0;

  async function provision(opts: {
    maxSeats: number;
    adminEmail: string;
    locale?: 'en' | 'de';
    modules?: string[];
  }) {
    const r = await provisionTenant(
      { db, mailer, baseURL },
      {
        name: `Tenant ${++slugCounter}`,
        slug: `t${slugCounter}-${run}`,
        adminEmail: opts.adminEmail,
        maxSeats: opts.maxSeats,
        modules: opts.modules ?? [],
        locale: opts.locale ?? 'en',
        actorUserId: platform.id,
      },
    );
    createdTenants.push(r.tenantId);
    return r;
  }

  async function accept(user: { email: string }, invitationId: string) {
    await auth.api.acceptInvitation({
      headers: await headersFor(user.email),
      body: { invitationId },
    });
  }

  const members = (tenantId: string) =>
    db.select().from(schema.member).where(eq(schema.member.organizationId, tenantId));

  const auditActions = async (tenantId: string) =>
    (await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, tenantId))).map(
      (a) => a.action,
    );

  beforeAll(async () => {
    platform = await signUp('platform');
    await db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, platform.id));
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      // Audit rows are append-only; the retention-purge switch is the only way to remove them.
      await tx.execute(sql`SELECT set_config('wis.audit_purge', 'on', true)`);
      if (createdTenants.length) {
        await tx.delete(schema.auditLog).where(inArray(schema.auditLog.tenantId, createdTenants));
      }
      if (createdUsers.length) {
        await tx.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, createdUsers));
      }
    });
    if (createdTenants.length) {
      await db.delete(schema.organization).where(inArray(schema.organization.id, createdTenants));
    }
    if (createdUsers.length) {
      await db.delete(schema.user).where(inArray(schema.user.id, createdUsers));
    }
    await pool.end();
  });

  describe('provisioning', () => {
    it('creates tenant, entitlements, modules, invitation and audit entry atomically', async () => {
      const admin = await signUp('prov-admin');
      const r = await provision({
        maxSeats: 5,
        adminEmail: admin.email,
        modules: ['work-schedule'],
        locale: 'de',
      });

      const [ent] = await db
        .select()
        .from(schema.tenantEntitlements)
        .where(eq(schema.tenantEntitlements.tenantId, r.tenantId));
      expect(ent).toMatchObject({ maxSeats: 5, status: 'trial' });
      const mods = await db
        .select()
        .from(schema.tenantModules)
        .where(eq(schema.tenantModules.tenantId, r.tenantId));
      expect(mods.map((m) => m.moduleId)).toEqual(['work-schedule']);
      expect(r.emailSent).toBe(true);
      expect(await auditActions(r.tenantId)).toContain('tenant.provisioned');

      const mail = sent.find((m) => m.to === admin.email);
      expect(mail?.subject).toContain('Einladung'); // localised
      expect(mail?.text).toContain(`/accept-invitation/${r.invitationId}`);

      await accept(admin, r.invitationId);
      const ms = await members(r.tenantId);
      expect(ms).toHaveLength(1);
      expect(ms[0]?.role).toBe('customer-admin');
      expect(await auditActions(r.tenantId)).toContain('invitation.accepted');
    });

    it('refuses actors that are not platform admins', async () => {
      const normal = await signUp('not-platform');
      await expect(
        provisionTenant(
          { db, mailer, baseURL },
          {
            name: 'Evil',
            slug: `evil-${run}`,
            adminEmail: normal.email,
            maxSeats: 1,
            actorUserId: normal.id,
          },
        ),
      ).rejects.toThrow(/platform admin/);
    });

    it('rolls back everything when provisioning fails (duplicate slug)', async () => {
      const a = await signUp('dup-a');
      const first = await provision({ maxSeats: 1, adminEmail: a.email });
      const slug = `t${slugCounter}-${run}`;
      await expect(
        provisionTenant(
          { db, mailer, baseURL },
          { name: 'Dup', slug, adminEmail: a.email, maxSeats: 1, actorUserId: platform.id },
        ),
      ).rejects.toThrow();
      const orgs = await db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.slug, slug));
      expect(orgs).toHaveLength(1);
      expect(orgs[0]?.id).toBe(first.tenantId);
    });

    it('does not let customers create or delete tenants', async () => {
      const u = await signUp('no-create');
      const headers = await headersFor(u.email);
      await expect(
        auth.api.createOrganization({ headers, body: { name: 'Self Made', slug: `self-${run}` } }),
      ).rejects.toThrow();

      const admin = await signUp('no-delete');
      const r = await provision({ maxSeats: 2, adminEmail: admin.email });
      await accept(admin, r.invitationId);
      await expect(
        auth.api.deleteOrganization({
          headers: await headersFor(admin.email),
          body: { organizationId: r.tenantId },
        }),
      ).rejects.toThrow();
    });
  });

  describe('seat limits', () => {
    it('blocks invitations beyond max seats with a stable error code', async () => {
      const admin = await signUp('seat-admin');
      const r = await provision({ maxSeats: 2, adminEmail: admin.email });
      await accept(admin, r.invitationId); // 1 member
      const headers = await headersFor(admin.email);

      await auth.api.createInvitation({
        headers,
        body: { email: `seat-1-${run}@wis.test`, role: 'employee', organizationId: r.tenantId },
      }); // 1 member + 1 pending = 2

      await expect(
        auth.api.createInvitation({
          headers,
          body: { email: `seat-2-${run}@wis.test`, role: 'employee', organizationId: r.tenantId },
        }),
      ).rejects.toThrow(TenantErrorCode.SEAT_LIMIT_REACHED);
    });

    it('is race-free: concurrent invitations never exceed max seats (DB trigger)', async () => {
      const admin = await signUp('race-admin');
      const r = await provision({ maxSeats: 4, adminEmail: admin.email }); // invitation reserves 1 seat
      await accept(admin, r.invitationId); // 1 member → 3 seats free

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          db.insert(schema.invitation).values({
            id: `race-${run}-${i}`,
            organizationId: r.tenantId,
            email: `race-${i}-${run}@wis.test`,
            role: 'employee',
            status: 'pending',
            expiresAt: new Date(Date.now() + 3_600_000),
            inviterId: admin.id,
          }),
        ),
      );
      const ok = results.filter((x) => x.status === 'fulfilled').length;
      expect(ok).toBe(3);
      const failures = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
      expect(failures.length).toBe(5);
      for (const f of failures) {
        expect((f.reason as { cause?: { code?: string } }).cause?.code).toBe('WS001');
      }
    });

    it('blocks tenants without entitlements (fail closed)', async () => {
      const [org] = await db
        .insert(schema.organization)
        .values({
          id: `orphan-${run}`,
          name: 'Orphan',
          slug: `orphan-${run}`,
          createdAt: new Date(),
        })
        .returning();
      createdTenants.push(org!.id);
      const u = await signUp('orphan-user');
      await expect(
        db.insert(schema.member).values({
          id: `m-orphan-${run}`,
          organizationId: org!.id,
          userId: u.id,
          role: 'employee',
          createdAt: new Date(),
        }),
      ).rejects.toMatchObject({ cause: { code: 'WS002' } });
    });
  });

  describe('roles & members', () => {
    it('keeps at least one customer-admin and lets a user belong to several tenants', async () => {
      const a1 = await signUp('last-a1');
      const a2 = await signUp('last-a2');
      const r = await provision({ maxSeats: 5, adminEmail: a1.email });
      await accept(a1, r.invitationId);
      const h1 = await headersFor(a1.email);

      // sole admin can neither be removed nor demoted
      await expect(
        auth.api.removeMember({
          headers: h1,
          body: { memberIdOrEmail: a1.email, organizationId: r.tenantId },
        }),
      ).rejects.toThrow(new RegExp(`${TenantErrorCode.LAST_ADMIN}|only owner`)); // better-auth's own guard may answer first
      const [m1] = await members(r.tenantId);
      await expect(
        auth.api.updateMemberRole({
          headers: h1,
          body: { memberId: m1!.id, role: 'employee', organizationId: r.tenantId },
        }),
      ).rejects.toThrow(new RegExp(`${TenantErrorCode.LAST_ADMIN}|without an owner`));

      // with a second admin, the first can step down
      const inv = await auth.api.createInvitation({
        headers: h1,
        body: { email: a2.email, role: 'customer-admin', organizationId: r.tenantId },
      });
      await accept(a2, inv.id);
      await auth.api.updateMemberRole({
        headers: h1,
        body: { memberId: m1!.id, role: 'employee', organizationId: r.tenantId },
      });
      expect((await members(r.tenantId)).map((m) => m.role).sort()).toEqual([
        'customer-admin',
        'employee',
      ]);
      expect(await auditActions(r.tenantId)).toEqual(
        expect.arrayContaining(['member.role_changed']),
      );
    });

    it('supports one user in several tenants and denies team-leads from inviting', async () => {
      const adminA = await signUp('multi-a');
      const adminB = await signUp('multi-b');
      const lead = await signUp('multi-lead');
      const ra = await provision({ maxSeats: 5, adminEmail: adminA.email });
      const rb = await provision({ maxSeats: 5, adminEmail: adminB.email });
      await accept(adminA, ra.invitationId);
      await accept(adminB, rb.invitationId);

      for (const [admin, r] of [
        [adminA, ra],
        [adminB, rb],
      ] as const) {
        const inv = await auth.api.createInvitation({
          headers: await headersFor(admin.email),
          body: { email: lead.email, role: 'team-lead', organizationId: r.tenantId },
        });
        await accept(lead, inv.id);
      }
      const headers = await headersFor(lead.email);
      const orgs = await auth.api.listOrganizations({ headers });
      expect(orgs.map((o) => o.id).sort()).toEqual([ra.tenantId, rb.tenantId].sort());
      const active = await auth.api.setActiveOrganization({
        headers,
        body: { organizationId: rb.tenantId },
      });
      expect(active?.id).toBe(rb.tenantId);

      await expect(
        auth.api.createInvitation({
          headers,
          body: { email: `x-${run}@wis.test`, role: 'employee', organizationId: ra.tenantId },
        }),
      ).rejects.toThrow();
    });
  });

  describe('tenant lifecycle', () => {
    it('validates transitions and blocks new members when suspended', async () => {
      expect(canTransition('trial', 'active')).toBe(true);
      expect(canTransition('offboarding', 'active')).toBe(false);

      const admin = await signUp('life-admin');
      const r = await provision({ maxSeats: 5, adminEmail: admin.email });
      await accept(admin, r.invitationId);

      await setTenantStatus(
        { db },
        { tenantId: r.tenantId, status: 'active', actorUserId: platform.id },
      );
      await setTenantStatus(
        { db },
        { tenantId: r.tenantId, status: 'suspended', actorUserId: platform.id, reason: 'unpaid' },
      );
      await expect(
        auth.api.createInvitation({
          headers: await headersFor(admin.email),
          body: { email: `life-${run}@wis.test`, role: 'employee', organizationId: r.tenantId },
        }),
      ).rejects.toThrow(TenantErrorCode.TENANT_NOT_ACTIVE);

      await setTenantStatus(
        { db },
        { tenantId: r.tenantId, status: 'offboarding', actorUserId: platform.id },
      );
      await expect(
        setTenantStatus(
          { db },
          { tenantId: r.tenantId, status: 'active', actorUserId: platform.id },
        ),
      ).rejects.toThrow(/Cannot change tenant status/);
      expect(await auditActions(r.tenantId)).toEqual(
        expect.arrayContaining(['tenant.status_changed']),
      );
    });
  });

  describe('row level security on tenancy tables', () => {
    it('lets a tenant read only its own entitlements and audit trail, append-only', async () => {
      const a = await signUp('rls-a');
      const b = await signUp('rls-b');
      const ra = await provision({ maxSeats: 3, adminEmail: a.email });
      const rb = await provision({ maxSeats: 9, adminEmail: b.email });

      const appPool = createPool(url ?? '', 2);
      const app = createDb(appPool);
      try {
        const ents = await withTenant(app, ra.tenantId, (tx) =>
          tx.execute(sql`SELECT tenant_id, max_seats FROM tenant_entitlements`),
        );
        expect(ents.rows).toEqual([{ tenant_id: ra.tenantId, max_seats: 3 }]);

        const audit = await withTenant(app, ra.tenantId, (tx) =>
          tx.execute(sql`SELECT DISTINCT tenant_id FROM audit_log`),
        );
        expect(audit.rows).toEqual([{ tenant_id: ra.tenantId }]);

        // tenants cannot change their own entitlements
        await expect(
          withTenant(app, ra.tenantId, (tx) =>
            tx.execute(sql`UPDATE tenant_entitlements SET max_seats = 9999`),
          ),
        ).rejects.toThrow();
        // tenants can append for themselves but not for others
        await withTenant(app, ra.tenantId, (tx) =>
          tx.execute(
            sql`INSERT INTO audit_log (tenant_id, actor_type, action) VALUES (${ra.tenantId}, 'user', 'test.own')`,
          ),
        );
        await expect(
          withTenant(app, ra.tenantId, (tx) =>
            tx.execute(
              sql`INSERT INTO audit_log (tenant_id, actor_type, action) VALUES (${rb.tenantId}, 'user', 'test.other')`,
            ),
          ),
        ).rejects.toThrow();
        // and never edit or delete (not even the owner)
        await expect(
          withTenant(app, ra.tenantId, (tx) => tx.execute(sql`DELETE FROM audit_log`)),
        ).rejects.toThrow();
        await expect(
          db.execute(
            sql`UPDATE audit_log SET action = 'tampered' WHERE tenant_id = ${ra.tenantId}`,
          ),
        ).rejects.toThrow();
        await expect(
          db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${ra.tenantId}`),
        ).rejects.toThrow();
      } finally {
        await appPool.end();
      }
    });

    it('keeps auth tables unreachable from the tenant role', async () => {
      const appPool = createPool(url ?? '', 2);
      const app = createDb(appPool);
      const causeOf = async (table: string) => {
        try {
          await withTenant(app, 'any-tenant', (tx) =>
            tx.execute(sql.raw(`SELECT * FROM "${table}" LIMIT 1`)),
          );
        } catch (e) {
          return String((e as { cause?: { message?: string } }).cause?.message ?? e);
        }
        return 'NO ERROR';
      };
      try {
        for (const t of ['user', 'member', 'session', 'invitation', 'organization']) {
          expect(await causeOf(t)).toMatch(/permission denied/i);
        }
      } finally {
        await appPool.end();
      }
    });
  });

  describe('platform audit', () => {
    it('records platform-admin actions without a tenant', async () => {
      const victim = await signUp('banned');
      const headers = await headersFor(platform.email);
      await auth.api.banUser({ headers, body: { userId: victim.id, banReason: 'test' } });
      const rows = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, 'platform.user_banned'),
            eq(schema.auditLog.targetId, victim.id),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId: null,
        actorType: 'platform',
        actorId: platform.id,
      });
    });
  });
});

describe('createAuth', () => {
  it('refuses production mode without a real mailer', () => {
    expect(() =>
      createAuth({
        db: drizzle.mock({ schema }),
        secret: 'x'.repeat(40),
        baseURL: 'http://localhost:3000',
        rpID: 'localhost',
        production: true,
      }),
    ).toThrow(/Mailer/);
  });
});
