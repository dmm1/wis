import { and, count, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema } from '@wis/db';
import { TenantError, TenantErrorCode } from './errors';
import { CREATOR_ROLE } from './permissions';

type Db = NodePgDatabase<typeof schema>;

/**
 * Friendly pre-check before inviting. The database trigger `enforce_seat_limit` is the
 * race-free guarantee; this only produces a clean error without hitting it in the common case.
 */
export async function assertSeatAvailable(db: Db, tenantId: string): Promise<void> {
  const [ent] = await db
    .select({ max: schema.tenantEntitlements.maxSeats, status: schema.tenantEntitlements.status })
    .from(schema.tenantEntitlements)
    .where(eq(schema.tenantEntitlements.tenantId, tenantId));
  if (!ent) throw new TenantError(TenantErrorCode.TENANT_NOT_PROVISIONED);
  if (ent.status === 'suspended' || ent.status === 'offboarding') {
    throw new TenantError(TenantErrorCode.TENANT_NOT_ACTIVE);
  }
  const [{ n: members } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, tenantId));
  const [{ n: pending } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, tenantId),
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    );
  if (members + pending >= ent.max) throw new TenantError(TenantErrorCode.SEAT_LIMIT_REACHED);
}

const hasRole = (roles: string | null | undefined, role: string) =>
  (roles ?? '')
    .split(',')
    .map((r) => r.trim())
    .includes(role);

/**
 * A tenant must always keep at least one customer-admin. Throws if removing the member, or
 * changing its roles to `newRoles`, would leave the tenant without one.
 */
export async function assertNotLastAdmin(
  db: Db,
  p: {
    tenantId: string;
    memberId: string;
    currentRoles: string | null | undefined;
    newRoles?: string;
  },
): Promise<void> {
  if (!hasRole(p.currentRoles, CREATOR_ROLE)) return;
  if (p.newRoles !== undefined && hasRole(p.newRoles, CREATOR_ROLE)) return;
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, p.tenantId),
        sql`${CREATOR_ROLE} = ANY(string_to_array(replace(${schema.member.role}, ' ', ''), ','))`,
      ),
    );
  if (n <= 1) throw new TenantError(TenantErrorCode.LAST_ADMIN);
}
