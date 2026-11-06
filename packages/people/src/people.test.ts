import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getBillingUsage,
  linkEmployeeToUser,
  snapshotUsage,
  tenantRoles,
  type TenantRoleName,
} from '@wis/auth';
import { createDb, schema, withTenant, type Tx } from '@wis/db';
import {
  createEmployee,
  createFieldDefinition,
  getEmployee,
  listEmployees,
  listFieldDefinitions,
  MAX_FIELDS_PER_ENTITY,
  PeopleError,
  setFieldArchived,
  updateEmployee,
  updateFieldDefinition,
  type Actor,
} from './index';

const url = process.env.DATABASE_URL;
const label = (en: string, de = en) => ({ en, de });

describe.skipIf(!url)('people: custom fields and employees (integration, RLS)', () => {
  const pool = new pg.Pool({ connectionString: url ?? '', max: 6 });
  const owner = drizzle(pool, { schema });
  const app = createDb(pool);
  const run = randomBytes(3).toString('hex');
  const tenants: string[] = [];
  const users: string[] = [];

  async function makeTenant(
    maxSeats = 100,
    preset: 'per_user' | 'per_employee' | 'both' = 'per_user',
  ) {
    const id = randomUUID();
    await owner.insert(schema.organization).values({
      id,
      name: `People ${tenants.length}`,
      slug: `ppl${tenants.length}-${run}`,
      createdAt: new Date(),
    });
    await owner
      .insert(schema.tenantEntitlements)
      .values({ tenantId: id, maxSeats, status: 'active', billing: { preset } });
    tenants.push(id);
    return id;
  }
  async function makeUser(label: string) {
    const id = randomUUID();
    await owner.insert(schema.user).values({
      id,
      name: label,
      email: `${label}-${run}@wis.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    users.push(id);
    return { id, email: `${label}-${run}@wis.test` };
  }
  const makeMember = (tenantId: string, userId: string, role = 'employee') =>
    owner
      .insert(schema.member)
      .values({ id: randomUUID(), organizationId: tenantId, userId, role, createdAt: new Date() });

  const actorFor = (tenantId: string, role: TenantRoleName): Actor => ({
    userId: `user-${role}`,
    tenantId,
    can: (resource, action) =>
      tenantRoles[role].authorize({ [resource]: [action] } as never).success,
  });
  const as = <T>(
    tenantId: string,
    role: TenantRoleName,
    fn: (tx: Tx, actor: Actor) => Promise<T>,
  ) => withTenant(app, tenantId, (tx) => fn(tx, actorFor(tenantId, role)));

  const expectCode = async (p: Promise<unknown>, code: string) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, `expected ${code}`).toBeInstanceOf(PeopleError);
    expect((err as PeopleError).code).toBe(code);
    return err as PeopleError;
  };

  afterAll(async () => {
    await owner.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('wis.audit_purge', 'on', true)`);
      if (tenants.length)
        await tx.delete(schema.auditLog).where(inArray(schema.auditLog.tenantId, tenants));
    });
    if (tenants.length)
      await owner.delete(schema.organization).where(inArray(schema.organization.id, tenants));
    if (users.length) await owner.delete(schema.user).where(inArray(schema.user.id, users));
    await pool.end();
  });

  beforeAll(() => undefined);

  describe('field definitions', () => {
    it('creates, lists in display order, and audits', async () => {
      const t = await makeTenant();
      await as(t, 'customer-admin', async (tx, a) => {
        await createFieldDefinition(tx, a, {
          entity: 'employee',
          key: 'shoe_size',
          type: 'number',
          label: label('Shoe size', 'Schuhgröße'),
          sortOrder: 20,
          validation: { min: 30, max: 55, integer: true },
        });
        await createFieldDefinition(tx, a, {
          entity: 'employee',
          key: 'license',
          type: 'text',
          label: label('Licence', 'Führerschein'),
          sortOrder: 10,
          validation: { maxLength: 12 },
        });
        const defs = await listFieldDefinitions(tx, t, 'employee');
        expect(defs.map((d) => d.key)).toEqual(['license', 'shoe_size']);
        expect(defs[1]?.label.de).toBe('Schuhgröße');
      });
      const audit = await owner
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.tenantId, t));
      expect(audit.filter((x) => x.action === 'field.created')).toHaveLength(2);
    });

    it('rejects unknown entities, duplicate keys, invalid input and non-admins', async () => {
      const t = await makeTenant();
      const base = {
        entity: 'employee',
        key: 'nick',
        type: 'text' as const,
        label: label('Nickname'),
        validation: { maxLength: 20 },
      };
      await as(t, 'customer-admin', async (tx, a) => {
        await expectCode(
          createFieldDefinition(tx, a, { ...base, entity: 'invoice' }),
          'UNKNOWN_ENTITY',
        );
        await createFieldDefinition(tx, a, base);
      });
      await expectCode(
        as(t, 'customer-admin', (tx, a) => createFieldDefinition(tx, a, base)),
        'DUPLICATE_KEY',
      );
      const bad = await expectCode(
        as(t, 'customer-admin', (tx, a) =>
          createFieldDefinition(tx, a, { ...base, key: 'Bad Key' }),
        ),
        'VALIDATION',
      );
      expect(bad.issues[0]?.path).toBe('key');
      await expectCode(
        as(t, 'planner', (tx, a) => createFieldDefinition(tx, a, { ...base, key: 'other' })),
        'FORBIDDEN',
      );
      await expectCode(
        as(t, 'hr-payroll', (tx, a) => createFieldDefinition(tx, a, { ...base, key: 'other' })),
        'FORBIDDEN',
      );
    });

    it('keeps key and type fixed, only grows options, and archives without losing data', async () => {
      const t = await makeTenant();
      const def = await as(t, 'customer-admin', (tx, a) =>
        createFieldDefinition(tx, a, {
          entity: 'employee',
          key: 'size',
          type: 'select',
          label: label('Shirt size'),
          options: [
            { value: 's', labels: label('S') },
            { value: 'm', labels: label('M') },
          ],
        }),
      );
      await expectCode(
        as(t, 'customer-admin', (tx, a) =>
          updateFieldDefinition(tx, a, def.id, { type: 'text' } as never),
        ),
        'IMMUTABLE_FIELD',
      );
      await expectCode(
        as(t, 'customer-admin', (tx, a) =>
          updateFieldDefinition(tx, a, def.id, { options: [{ value: 's', labels: label('S') }] }),
        ),
        'OPTION_REMOVED',
      );
      const grown = await as(t, 'customer-admin', (tx, a) =>
        updateFieldDefinition(tx, a, def.id, {
          label: label('T-shirt size', 'T-Shirt-Größe'),
          options: [
            { value: 's', labels: label('Small') },
            { value: 'm', labels: label('M') },
            { value: 'l', labels: label('L') },
          ],
        }),
      );
      expect(grown.options.map((o) => o.value)).toEqual(['s', 'm', 'l']);
      expect(grown.options[0]?.labels.en).toBe('Small');

      // stored values survive archiving and come back on restore
      const emp = await as(t, 'customer-admin', (tx, a) =>
        createEmployee(tx, a, { firstName: 'A', lastName: 'B', customData: { size: 'l' } }),
      );
      await as(t, 'customer-admin', (tx, a) => setFieldArchived(tx, a, def.id, true));
      expect(
        (await as(t, 'customer-admin', (tx, a) => getEmployee(tx, a, emp.id))).customData,
      ).toEqual({});
      await expectCode(
        as(t, 'customer-admin', (tx, a) =>
          createEmployee(tx, a, { firstName: 'C', lastName: 'D', customData: { size: 'm' } }),
        ),
        'VALIDATION',
      );
      await as(t, 'customer-admin', (tx, a) => setFieldArchived(tx, a, def.id, false));
      expect(
        (await as(t, 'customer-admin', (tx, a) => getEmployee(tx, a, emp.id))).customData,
      ).toEqual({ size: 'l' });
    });

    it('limits the number of fields per entity', async () => {
      const t = await makeTenant();
      await as(t, 'customer-admin', async (tx, a) => {
        for (let i = 0; i < MAX_FIELDS_PER_ENTITY; i++) {
          await createFieldDefinition(tx, a, {
            entity: 'employee',
            key: `f${i}`,
            type: 'boolean',
            label: label(`F${i}`),
          });
        }
      });
      await expectCode(
        as(t, 'customer-admin', (tx, a) =>
          createFieldDefinition(tx, a, {
            entity: 'employee',
            key: 'one_too_many',
            type: 'boolean',
            label: label('X'),
          }),
        ),
        'TOO_MANY_FIELDS',
      );
    }, 60_000);
  });

  describe('employees with custom data', () => {
    async function tenantWithFields() {
      const t = await makeTenant();
      await as(t, 'customer-admin', async (tx, a) => {
        const f = (d: Parameters<typeof createFieldDefinition>[2]) =>
          createFieldDefinition(tx, a, d);
        await f({
          entity: 'employee',
          key: 'license',
          type: 'text',
          label: label('Licence'),
          required: true,
          validation: { maxLength: 12, pattern: '^[A-Z0-9-]+$' },
        });
        await f({
          entity: 'employee',
          key: 'shoe_size',
          type: 'number',
          label: label('Shoe size'),
          validation: { min: 30, max: 55, integer: true },
        });
        await f({
          entity: 'employee',
          key: 'started_driving',
          type: 'date',
          label: label('Driving since'),
        });
        await f({
          entity: 'employee',
          key: 'team_player',
          type: 'boolean',
          label: label('Team player'),
        });
        await f({
          entity: 'employee',
          key: 'role_pref',
          type: 'select',
          label: label('Preferred role'),
          options: [
            { value: 'bar', labels: label('Bar') },
            { value: 'kitchen', labels: label('Kitchen') },
          ],
        });
        await f({
          entity: 'employee',
          key: 'iban',
          type: 'text',
          label: label('IBAN'),
          sensitive: true,
          validation: { maxLength: 34 },
        });
      });
      return t;
    }

    it('validates custom data against the tenant definitions and reports field paths', async () => {
      const t = await tenantWithFields();
      const ok = await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, {
          firstName: ' Anna ',
          lastName: 'Gruber',
          email: 'anna@example.com',
          startDate: '2025-01-01',
          customData: {
            license: 'AB-12',
            shoe_size: 40,
            role_pref: 'bar',
            team_player: true,
            iban: 'DE89',
          },
        }),
      );
      expect(ok).toMatchObject({ firstName: 'Anna', hasLogin: false, active: true });
      expect(ok.customData).toMatchObject({ license: 'AB-12', shoe_size: 40, iban: 'DE89' });

      const err = await expectCode(
        as(t, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, {
            firstName: 'X',
            lastName: 'Y',
            customData: { license: 'bad value!', shoe_size: 99, role_pref: 'pool', surprise: 1 },
          }),
        ),
        'VALIDATION',
      );
      const paths = err.issues.map((i) => i.path);
      expect(paths.some((p) => p.startsWith('customData.'))).toBe(true);
      // issues are translatable: machine-readable code and bounds, not just English text
      const shoe = err.issues.find((i) => i.path === 'customData.shoe_size');
      expect(shoe).toMatchObject({ code: 'too_big', origin: 'number', maximum: 55 });
      await expectCode(
        as(t, 'hr-payroll', (tx, a) => createEmployee(tx, a, { firstName: 'X', lastName: 'Y' })),
        'VALIDATION',
      ); // license required
      await expectCode(
        as(t, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, {
            firstName: 'X',
            lastName: 'Y',
            email: 'nope',
            customData: { license: 'A1' },
          }),
        ),
        'VALIDATION',
      );
      await expectCode(
        as(t, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, {
            firstName: 'X',
            lastName: 'Y',
            startDate: '2025-05-01',
            endDate: '2025-04-01',
            customData: { license: 'A1' },
          }),
        ),
        'VALIDATION',
      );
    });

    it('enforces permissions and keeps sensitive fields away from roles without access', async () => {
      const t = await tenantWithFields();
      await expectCode(
        as(t, 'planner', (tx, a) =>
          createEmployee(tx, a, { firstName: 'P', lastName: 'Q', customData: { license: 'A1' } }),
        ),
        'FORBIDDEN',
      );
      const emp = await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, {
          firstName: 'Hans',
          lastName: 'Huber',
          customData: { license: 'A1', iban: 'DE-SECRET' },
        }),
      );

      const seenByPlanner = await as(t, 'planner', (tx, a) => getEmployee(tx, a, emp.id));
      expect(seenByPlanner.customData).toEqual({ license: 'A1' }); // no iban
      expect(JSON.stringify(seenByPlanner)).not.toContain('DE-SECRET');
      await expectCode(
        as(t, 'employee', (tx, a) => getEmployee(tx, a, emp.id)),
        'FORBIDDEN',
      );

      // a role that may update but not read sensitive data can neither write nor see it
      const lead: Actor = {
        userId: 'u',
        tenantId: t,
        can: (r, act) => r === 'employee' && ['read', 'update'].includes(act),
      };
      await expectCode(
        withTenant(app, t, (tx) =>
          updateEmployee(tx, lead, emp.id, { customData: { license: 'A1', iban: 'HACK' } }),
        ),
        'VALIDATION',
      );
      await withTenant(app, t, (tx) =>
        updateEmployee(tx, lead, emp.id, {
          shoe: undefined,
          customData: { license: 'B2', shoe_size: 41 },
        } as never),
      );
      const after = await as(t, 'hr-payroll', (tx, a) => getEmployee(tx, a, emp.id));
      expect(after.customData).toMatchObject({ license: 'B2', shoe_size: 41, iban: 'DE-SECRET' }); // iban preserved
    });

    it('preserves values of archived fields and clears optional ones with null', async () => {
      const t = await tenantWithFields();
      const emp = await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, {
          firstName: 'E',
          lastName: 'F',
          customData: { license: 'A1', shoe_size: 38, team_player: true },
        }),
      );
      const defs = await as(t, 'customer-admin', (tx) => listFieldDefinitions(tx, t, 'employee'));
      await as(t, 'customer-admin', (tx, a) =>
        setFieldArchived(tx, a, defs.find((d) => d.key === 'team_player')!.id, true),
      );

      const updated = await as(t, 'hr-payroll', (tx, a) =>
        updateEmployee(tx, a, emp.id, { customData: { license: 'A1', shoe_size: null } }),
      );
      expect(updated.customData).toEqual({ license: 'A1' }); // shoe_size cleared
      const raw = await owner.select().from(schema.employee).where(eq(schema.employee.id, emp.id));
      expect(raw[0]?.customData).toEqual({ license: 'A1', team_player: true }); // archived value kept
    });

    it('enforces unique personnel numbers per tenant', async () => {
      const t = await tenantWithFields();
      const other = await tenantWithFields();
      const mk = (tenant: string, pn: string) =>
        as(tenant, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, {
            firstName: 'N',
            lastName: pn,
            personnelNumber: pn,
            customData: { license: 'A1' },
          }),
        );
      await mk(t, '1001');
      await expectCode(mk(t, '1001'), 'DUPLICATE_PERSONNEL_NUMBER');
      await mk(other, '1001'); // same number in another tenant is fine
    });

    it('searches, filters by status and by a custom field, and paginates', async () => {
      const t = await tenantWithFields();
      const mk = (
        first: string,
        last: string,
        extra: Record<string, unknown> = {},
        dates: { startDate?: string; endDate?: string } = {},
      ) =>
        as(t, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, {
            firstName: first,
            lastName: last,
            ...dates,
            customData: { license: 'A1', ...extra },
          }),
        );
      await mk('Anna', 'Adler', { role_pref: 'bar' });
      await mk('Berta', 'Bauer', { role_pref: 'kitchen' });
      await mk('Carl', 'Cerny', { role_pref: 'bar' }, { endDate: '2020-01-01' }); // ended
      await mk('Dora', 'Dietl', {}, { startDate: '2999-01-01' }); // not started yet

      const list = (q: Parameters<typeof listEmployees>[2]) =>
        as(t, 'planner', (tx, a) => listEmployees(tx, a, q));
      expect((await list({})).items.map((e) => e.lastName)).toEqual(['Adler', 'Bauer']); // active only by default
      expect((await list({ status: 'inactive' })).items.map((e) => e.lastName)).toEqual([
        'Cerny',
        'Dietl',
      ]);
      expect((await list({ status: 'all' })).total).toBe(4);
      expect((await list({ search: 'anna adl' })).items.map((e) => e.lastName)).toEqual(['Adler']);
      expect((await list({ search: '%' })).total).toBe(0); // wildcards are literal
      expect(
        (await list({ status: 'all', custom: { key: 'role_pref', value: 'bar' } })).items.map(
          (e) => e.lastName,
        ),
      ).toEqual(['Adler', 'Cerny']);
      await expectCode(list({ custom: { key: 'iban', value: 'x' } }), 'VALIDATION'); // sensitive: not filterable by planner
      await expectCode(list({ custom: { key: 'nope', value: 'x' } }), 'VALIDATION');
      const page = await list({ status: 'all', limit: 2, offset: 2 });
      expect(page.items.map((e) => e.lastName)).toEqual(['Cerny', 'Dietl']);
      expect(page.total).toBe(4);
    });

    it('writes audit entries that name the changed fields but never their values', async () => {
      const t = await tenantWithFields();
      const emp = await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, {
          firstName: 'Au',
          lastName: 'Dit',
          customData: { license: 'A1', iban: 'DE-VERY-SECRET' },
        }),
      );
      await as(t, 'hr-payroll', (tx, a) =>
        updateEmployee(tx, a, emp.id, { customData: { license: 'A2', iban: 'DE-OTHER-SECRET' } }),
      );
      const rows = await owner
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, emp.id));
      expect(rows.map((r) => r.action).sort()).toEqual(['employee.created', 'employee.updated']);
      expect(JSON.stringify(rows)).not.toMatch(/SECRET|A2/);
    });
  });

  describe('tenant isolation', () => {
    it("never shows or changes another tenant's employees or definitions", async () => {
      const a = await makeTenant();
      const b = await makeTenant();
      await as(a, 'customer-admin', (tx, act) =>
        createFieldDefinition(tx, act, {
          entity: 'employee',
          key: 'secret_a',
          type: 'boolean',
          label: label('A only'),
        }),
      );
      const empA = await as(a, 'customer-admin', (tx, act) =>
        createEmployee(tx, act, { firstName: 'Only', lastName: 'InA' }),
      );

      expect(
        (await as(b, 'customer-admin', (tx, act) => listEmployees(tx, act, { status: 'all' })))
          .total,
      ).toBe(0);
      expect(
        await as(b, 'customer-admin', (tx) =>
          listFieldDefinitions(tx, b, 'employee', { includeArchived: true }),
        ),
      ).toEqual([]);
      await expectCode(
        as(b, 'customer-admin', (tx, act) => getEmployee(tx, act, empA.id)),
        'NOT_FOUND',
      );
      await expectCode(
        as(b, 'customer-admin', (tx, act) =>
          updateEmployee(tx, act, empA.id, { firstName: 'Hacked' }),
        ),
        'NOT_FOUND',
      );

      // even with a forged tenant in the query, RLS holds
      const forged = await withTenant(app, b, (tx) =>
        tx.select().from(schema.employee).where(eq(schema.employee.tenantId, a)),
      );
      expect(forged).toEqual([]);
      await expect(
        withTenant(app, b, (tx) =>
          tx.insert(schema.employee).values({ tenantId: a, firstName: 'X', lastName: 'Y' }),
        ),
      ).rejects.toThrow();
      const untouched = await owner
        .select()
        .from(schema.employee)
        .where(eq(schema.employee.id, empA.id));
      expect(untouched[0]?.firstName).toBe('Only');
    });
  });

  describe('billable headcount: every person counted once', () => {
    it('counts categories correctly and never double counts a person with a login', async () => {
      const t = await makeTenant(100, 'both');
      const [u1, u2] = await Promise.all([makeUser('login-1'), makeUser('login-2')]);
      await makeMember(t, u1.id, 'customer-admin');
      await makeMember(t, u2.id, 'planner');
      const mk = (first: string, extra: { endDate?: string; email?: string } = {}) =>
        as(t, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, { firstName: first, lastName: 'Test', ...extra }),
        );
      const e1 = await mk('One'); // will be linked to u1
      const e2 = await mk('Two'); // no login
      await mk('Three', { endDate: '2020-01-01' }); // ended: not billable
      await owner.insert(schema.invitation).values({
        id: randomUUID(),
        organizationId: t,
        email: `invitee-${run}@wis.test`,
        role: 'employee',
        status: 'pending',
        expiresAt: new Date(Date.now() + 3_600_000),
        inviterId: u1.id,
      });

      // before linking: u1 and e1 are the same human but not yet linked -> two rows (link them!)
      await linkEmployeeToUser(owner, {
        tenantId: t,
        employeeId: e1.id,
        userId: u1.id,
        actorUserId: u1.id,
      });
      const usage = await getBillingUsage(owner, t);
      expect(usage.counts).toEqual({ employee_with_login: 1, employee_no_login: 1, user_only: 2 }); // u2 + open invitation
      expect(usage.reservedInvitations).toBe(1);
      expect(usage.billable).toBe(4); // preset both: 1 + 1 + 2

      // linking the second employee to the second login merges two rows into one person
      await linkEmployeeToUser(owner, {
        tenantId: t,
        employeeId: e2.id,
        userId: u2.id,
        actorUserId: u1.id,
      });
      const merged = await getBillingUsage(owner, t);
      expect(merged.counts).toEqual({ employee_with_login: 2, employee_no_login: 0, user_only: 1 });
      expect(merged.billable).toBe(3);
    });

    it('applies the tenant billing preset', async () => {
      const t = await makeTenant(100, 'per_user');
      const u = await makeUser('preset-user');
      await makeMember(t, u.id, 'customer-admin');
      await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, { firstName: 'No', lastName: 'Login' }),
      );
      await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, { firstName: 'Also', lastName: 'NoLogin' }),
      );
      const set = (preset: string) =>
        owner
          .update(schema.tenantEntitlements)
          .set({ billing: { preset } })
          .where(eq(schema.tenantEntitlements.tenantId, t));
      expect((await getBillingUsage(owner, t)).billable).toBe(1); // per user: the login only
      await set('per_employee');
      expect((await getBillingUsage(owner, t)).billable).toBe(2); // per employee: two employees
      await set('both');
      expect((await getBillingUsage(owner, t)).billable).toBe(3);
    });

    it('does not count an invitation twice when the person is already an employee or member', async () => {
      const t = await makeTenant(100, 'both');
      const u = await makeUser('dup-member');
      await makeMember(t, u.id, 'employee');
      const emp = await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, {
          firstName: 'Known',
          lastName: 'Person',
          email: `known-${run}@wis.test`,
        }),
      );
      const inv = (email: string) =>
        owner.insert(schema.invitation).values({
          id: randomUUID(),
          organizationId: t,
          email,
          role: 'employee',
          status: 'pending',
          expiresAt: new Date(Date.now() + 3_600_000),
          inviterId: u.id,
        });
      await inv(`known-${run}@wis.test`); // matches an active employee -> already counted as that employee
      await inv(u.email.toUpperCase()); // matches an existing member (case-insensitive)
      const usage = await getBillingUsage(owner, t);
      expect(usage.reservedInvitations).toBe(0);
      expect(usage.counts).toEqual({ employee_with_login: 0, employee_no_login: 1, user_only: 1 });
      expect(emp.hasLogin).toBe(false);
    });

    it('refuses to link a person who is not a member, or an account already linked', async () => {
      const t = await makeTenant();
      const [m, stranger] = await Promise.all([makeUser('linkable'), makeUser('stranger')]);
      await makeMember(t, m.id);
      const [e1, e2] = [
        await as(t, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, { firstName: 'L1', lastName: 'x' }),
        ),
        await as(t, 'hr-payroll', (tx, a) =>
          createEmployee(tx, a, { firstName: 'L2', lastName: 'x' }),
        ),
      ];
      await expect(
        linkEmployeeToUser(owner, {
          tenantId: t,
          employeeId: e1.id,
          userId: stranger.id,
          actorUserId: m.id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
      await linkEmployeeToUser(owner, {
        tenantId: t,
        employeeId: e1.id,
        userId: m.id,
        actorUserId: m.id,
      });
      await expect(
        linkEmployeeToUser(owner, {
          tenantId: t,
          employeeId: e2.id,
          userId: m.id,
          actorUserId: m.id,
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
      await expect(
        linkEmployeeToUser(owner, {
          tenantId: t,
          employeeId: randomUUID(),
          userId: m.id,
          actorUserId: m.id,
        }),
      ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
      await linkEmployeeToUser(owner, {
        tenantId: t,
        employeeId: e1.id,
        userId: null,
        actorUserId: m.id,
      }); // unlink
      expect((await as(t, 'hr-payroll', (tx, a) => getEmployee(tx, a, e1.id))).hasLogin).toBe(
        false,
      );
    });
  });

  describe('seat limit counts billable people', () => {
    it('stops new billable employees at the limit (per employee) but lets unbilled ones in (per user)', async () => {
      const perEmployee = await makeTenant(2, 'per_employee');
      const mk = (t: string, n: string) =>
        as(t, 'hr-payroll', (tx, a) => createEmployee(tx, a, { firstName: n, lastName: 'S' }));
      await mk(perEmployee, 'a');
      await mk(perEmployee, 'b');
      await expectCode(mk(perEmployee, 'c'), 'SEAT_LIMIT_REACHED');

      const perUser = await makeTenant(1, 'per_user');
      const u = await makeUser('seat-owner');
      await makeMember(perUser, u.id, 'customer-admin'); // uses the only seat
      for (const n of ['a', 'b', 'c']) await mk(perUser, n); // employees without login are not billed in this preset
      expect((await getBillingUsage(owner, perUser)).billable).toBe(1);
    });

    it('is race-free for employees too', async () => {
      const t = await makeTenant(3, 'per_employee');
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          as(t, 'hr-payroll', (tx, a) =>
            createEmployee(tx, a, { firstName: `R${i}`, lastName: 'Race' }),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
        expect((r.reason as PeopleError).code).toBe('SEAT_LIMIT_REACHED');
      }
    });
  });

  describe('usage snapshots', () => {
    it('stores the billable headcount per category, once per day', async () => {
      const t = await makeTenant(100, 'both');
      await as(t, 'hr-payroll', (tx, a) =>
        createEmployee(tx, a, { firstName: 'Snap', lastName: 'Shot' }),
      );
      const day = '2031-01-15';
      await snapshotUsage(owner, day, { tenantIds: [t] });
      await snapshotUsage(owner, day, { tenantIds: [t] }); // idempotent
      const rows = await owner
        .select()
        .from(schema.usageSnapshots)
        .where(eq(schema.usageSnapshots.tenantId, t));
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.category === 'employee_no_login')?.count).toBe(1);
      await owner.delete(schema.usageSnapshots).where(eq(schema.usageSnapshots.tenantId, t));
    });
  });
});
