import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildCustomDataSchema,
  compactCustomData,
  protectedKeys,
  visibleCustomData,
  type FieldDefinition,
} from '@wis/core';
import { schema, writeAudit, type Tx } from '@wis/db';
import { requireCan, type Actor } from './actor';
import { mapDbError, PeopleError, toIssue } from './errors';
import { listFieldDefinitions } from './fields';

const ENTITY = 'employee';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) &&
      new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    'Not a real date',
  );

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const baseFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.preprocess(emptyToNull, z.email().max(200).nullable()).default(null),
  personnelNumber: z
    .preprocess(emptyToNull, z.string().trim().min(1).max(40).nullable())
    .default(null),
  startDate: z.preprocess(emptyToNull, isoDate.nullable()).default(null),
  endDate: z.preprocess(emptyToNull, isoDate.nullable()).default(null),
};

const datesOk = (d: { startDate: string | null; endDate: string | null }) =>
  !d.startDate || !d.endDate || d.endDate >= d.startDate;
const DATES_MESSAGE = { message: 'The end date is before the start date', path: ['endDate'] };

export const createEmployeeSchema = z
  .object({ ...baseFields, customData: z.record(z.string(), z.unknown()).default({}) })
  .refine(datesOk, DATES_MESSAGE);
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    firstName: baseFields.firstName,
    lastName: baseFields.lastName,
    email: z.preprocess(emptyToNull, z.email().max(200).nullable()),
    personnelNumber: z.preprocess(emptyToNull, z.string().trim().min(1).max(40).nullable()),
    startDate: z.preprocess(emptyToNull, isoDate.nullable()),
    endDate: z.preprocess(emptyToNull, isoDate.nullable()),
    /** The complete set of writable custom values; omitted optional fields are cleared. */
    customData: z.record(z.string(), z.unknown()),
  })
  .partial();
export type UpdateEmployeeInput = z.input<typeof updateEmployeeSchema>;

export interface EmployeeView {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  personnelNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Has a linked login (see linkEmployeeToUser in @wis/auth). */
  hasLogin: boolean;
  /** Employment covers today. */
  active: boolean;
  /** Only the values the caller may see. */
  customData: Record<string, unknown>;
}

type Row = typeof schema.employee.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

function toView(r: Row, defs: FieldDefinition[], actor: Actor): EmployeeView {
  const t = today();
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    personnelNumber: r.personnelNumber,
    startDate: r.startDate,
    endDate: r.endDate,
    hasLogin: r.userId !== null,
    active: (!r.startDate || r.startDate <= t) && (!r.endDate || r.endDate >= t),
    customData: visibleCustomData(defs, r.customData as Record<string, unknown>, {
      canReadSensitive: actor.can('employee', 'read-sensitive'),
    }),
  };
}

const issues = (e: z.ZodError) => e.issues.map(toIssue);
const UNIQUE = { employee_tenant_personnel_number_uniq: 'DUPLICATE_PERSONNEL_NUMBER' } as const;

function validateCustom(defs: FieldDefinition[], actor: Actor, data: Record<string, unknown>) {
  const canWriteSensitive = actor.can('employee', 'read-sensitive');
  const parsed = buildCustomDataSchema(defs, { canWriteSensitive }).safeParse(data);
  if (!parsed.success) {
    throw new PeopleError(
      'VALIDATION',
      issues(parsed.error).map((i) => ({ ...i, path: `customData.${i.path}` })),
    );
  }
  return { values: parsed.data as Record<string, unknown>, canWriteSensitive };
}

export async function createEmployee(
  tx: Tx,
  actor: Actor,
  raw: CreateEmployeeInput,
): Promise<EmployeeView> {
  requireCan(actor, 'employee', 'create');
  const parsed = createEmployeeSchema.safeParse(raw);
  if (!parsed.success) throw new PeopleError('VALIDATION', issues(parsed.error));
  const { customData, ...base } = parsed.data;

  const defs = await listFieldDefinitions(tx, actor.tenantId, ENTITY, { includeArchived: true });
  const { values } = validateCustom(defs, actor, customData);

  try {
    const [row] = await tx
      .insert(schema.employee)
      .values({ ...base, tenantId: actor.tenantId, customData: compactCustomData(values) })
      .returning();
    await writeAudit(tx, {
      tenantId: actor.tenantId,
      actorType: 'user',
      actorId: actor.userId,
      action: 'employee.created',
      targetType: 'employee',
      targetId: row!.id,
    });
    return toView(row!, defs, actor);
  } catch (e) {
    return mapDbError(e, UNIQUE);
  }
}

export async function updateEmployee(
  tx: Tx,
  actor: Actor,
  id: string,
  raw: UpdateEmployeeInput,
): Promise<EmployeeView> {
  requireCan(actor, 'employee', 'update');
  const parsed = updateEmployeeSchema.safeParse(raw);
  if (!parsed.success) throw new PeopleError('VALIDATION', issues(parsed.error));
  const { customData, ...base } = parsed.data;

  const [row] = await tx
    .select()
    .from(schema.employee)
    .where(and(eq(schema.employee.id, id), eq(schema.employee.tenantId, actor.tenantId)))
    .for('update');
  if (!row) throw new PeopleError('NOT_FOUND');

  const merged = {
    startDate: base.startDate ?? row.startDate,
    endDate: base.endDate === undefined ? row.endDate : base.endDate,
  };
  if (!datesOk(merged))
    throw new PeopleError('VALIDATION', [{ path: 'endDate', message: DATES_MESSAGE.message }]);

  const defs = await listFieldDefinitions(tx, actor.tenantId, ENTITY, { includeArchived: true });
  let nextCustom: Record<string, unknown> | undefined;
  if (customData !== undefined) {
    const { values, canWriteSensitive } = validateCustom(defs, actor, customData);
    // Values the caller can't write (archived fields, sensitive fields without permission) stay as they are.
    const keep = protectedKeys(defs, { canWriteSensitive });
    const existing = row.customData as Record<string, unknown>;
    const preserved = Object.fromEntries(
      Object.entries(existing).filter(([k]) => keep.has(k) || !defs.some((d) => d.key === k)),
    );
    nextCustom = { ...preserved, ...compactCustomData(values) };
  }

  try {
    const [updated] = await tx
      .update(schema.employee)
      .set({ ...base, ...(nextCustom ? { customData: nextCustom } : {}), updatedAt: new Date() })
      .where(eq(schema.employee.id, id))
      .returning();
    await writeAudit(tx, {
      tenantId: actor.tenantId,
      actorType: 'user',
      actorId: actor.userId,
      action: 'employee.updated',
      targetType: 'employee',
      targetId: id,
      // Which fields changed, never their values (they may be personal or sensitive data).
      metadata: {
        changed: [...Object.keys(base), ...(customData !== undefined ? ['customData'] : [])],
      },
    });
    return toView(updated!, defs, actor);
  } catch (e) {
    return mapDbError(e, UNIQUE);
  }
}

export async function getEmployee(tx: Tx, actor: Actor, id: string): Promise<EmployeeView> {
  requireCan(actor, 'employee', 'read');
  const [row] = await tx
    .select()
    .from(schema.employee)
    .where(and(eq(schema.employee.id, id), eq(schema.employee.tenantId, actor.tenantId)));
  if (!row) throw new PeopleError('NOT_FOUND');
  const defs = await listFieldDefinitions(tx, actor.tenantId, ENTITY, { includeArchived: true });
  return toView(row, defs, actor);
}

export interface ListEmployeesQuery {
  search?: string;
  /** Default: active. */
  status?: 'active' | 'inactive' | 'all';
  /** Equality filter on one custom field (uses the GIN index). */
  custom?: { key: string; value: string | number | boolean };
  limit?: number;
  offset?: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export async function listEmployees(tx: Tx, actor: Actor, q: ListEmployeesQuery = {}) {
  requireCan(actor, 'employee', 'read');
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
  const offset = Math.max(q.offset ?? 0, 0);
  const defs = await listFieldDefinitions(tx, actor.tenantId, ENTITY, { includeArchived: true });

  const filters: (SQL | undefined)[] = [eq(schema.employee.tenantId, actor.tenantId)];
  const status = q.status ?? 'active';
  const t = today();
  const activeSql = and(
    or(isNull(schema.employee.startDate), sql`${schema.employee.startDate} <= ${t}`),
    or(isNull(schema.employee.endDate), sql`${schema.employee.endDate} >= ${t}`),
  );
  if (status === 'active') filters.push(activeSql);
  if (status === 'inactive') filters.push(sql`NOT (${activeSql})`);

  const term = q.search?.trim();
  if (term) {
    const like = `%${escapeLike(term.slice(0, 100))}%`;
    filters.push(
      or(
        ilike(schema.employee.firstName, like),
        ilike(schema.employee.lastName, like),
        ilike(schema.employee.email, like),
        ilike(schema.employee.personnelNumber, like),
        sql`(${schema.employee.firstName} || ' ' || ${schema.employee.lastName}) ILIKE ${like}`,
      ),
    );
  }
  if (q.custom) {
    const def = defs.find((d) => d.key === q.custom!.key && !d.archivedAt);
    if (!def || (def.sensitive && !actor.can('employee', 'read-sensitive'))) {
      throw new PeopleError('VALIDATION', [{ path: 'custom.key', message: 'Unknown field' }]);
    }
    filters.push(
      sql`${schema.employee.customData} @> ${JSON.stringify({ [def.key]: q.custom.value })}::jsonb`,
    );
  }

  const where = and(...filters);
  const rows = await tx
    .select()
    .from(schema.employee)
    .where(where)
    .orderBy(asc(schema.employee.lastName), asc(schema.employee.firstName), asc(schema.employee.id))
    .limit(limit)
    .offset(offset);
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.employee)
    .where(where);
  return { items: rows.map((r) => toView(r, defs, actor)), total: n };
}
