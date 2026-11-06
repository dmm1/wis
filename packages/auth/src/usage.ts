import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  billableCategories,
  billingConfigSchema,
  type BillingCategory,
  type BillingConfig,
} from '@wis/core';
import { schema } from '@wis/db';

type Db = NodePgDatabase<typeof schema>;

export interface BillingUsage {
  counts: Record<BillingCategory, number>;
  /** Open invitations reserving a seat (already part of `counts.user_only`). */
  reservedInvitations: number;
  preset: BillingConfig['preset'];
  /** Billable people for the tenant's preset, including reserved seats. This is what the seat limit checks. */
  billable: number;
  /** Billable people that are really there (excludes reservations). */
  inUse: number;
  /** Reserved seats that count under this preset. */
  reserved: number;
}

/**
 * Billable headcount of a tenant, computed by the same SQL functions the seat-limit trigger uses,
 * so screens can never disagree with enforcement. Each active person is counted once.
 */
export async function getBillingUsage(db: Db, tenantId: string): Promise<BillingUsage> {
  const [ent] = await db
    .select({ billing: schema.tenantEntitlements.billing })
    .from(schema.tenantEntitlements)
    .where(eq(schema.tenantEntitlements.tenantId, tenantId));
  const preset = billingConfigSchema.parse(ent?.billing ?? {}).preset;

  const res = await db.execute(sql`SELECT * FROM tenant_billing_counts(${tenantId})`);
  const row = (res.rows[0] ?? {}) as Record<string, number>;
  const counts: Record<BillingCategory, number> = {
    employee_with_login: Number(row.employee_with_login ?? 0),
    employee_no_login: Number(row.employee_no_login ?? 0),
    user_only: Number(row.user_only ?? 0),
  };
  const reservedInvitations = Number(row.reserved_invitations ?? 0);
  const billable = billableCategories({ preset }).reduce((sum, c) => sum + counts[c], 0);
  const reserved = billableCategories({ preset }).includes('user_only') ? reservedInvitations : 0;
  return { counts, reservedInvitations, preset, billable, inUse: billable - reserved, reserved };
}

/** Whether one more invitation would take a seat under the tenant's preset (it does when logins are billed). */
export const invitationTakesSeat = (preset: BillingConfig['preset']) =>
  billableCategories({ preset }).includes('user_only');

/**
 * Stores the billable headcount for every tenant (or the given ones) for a day; idempotent per day.
 * Run daily by a scheduled job; invoicing reads these rows (period end, peak or average, per the
 * tenant's billing config). A tenant deleted while the job runs is skipped, not an error.
 */
export async function snapshotUsage(
  db: Db,
  day: string = new Date().toISOString().slice(0, 10),
  opts: { tenantIds?: string[] } = {},
): Promise<number> {
  const ids =
    opts.tenantIds ??
    (
      await db.select({ id: schema.tenantEntitlements.tenantId }).from(schema.tenantEntitlements)
    ).map((t) => t.id);
  let rows = 0;
  for (const id of ids) {
    try {
      const { counts } = await getBillingUsage(db, id);
      for (const [category, count] of Object.entries(counts)) {
        await db
          .insert(schema.usageSnapshots)
          .values({ tenantId: id, day, category, count })
          .onConflictDoUpdate({
            target: [
              schema.usageSnapshots.tenantId,
              schema.usageSnapshots.day,
              schema.usageSnapshots.category,
            ],
            set: { count },
          });
        rows++;
      }
    } catch (e) {
      const code =
        (e as { code?: string; cause?: { code?: string } }).cause?.code ??
        (e as { code?: string }).code;
      if (code !== '23503') throw e; // foreign key: the tenant was deleted meanwhile
    }
  }
  return rows;
}
