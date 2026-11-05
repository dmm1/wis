import { and, count, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema } from '@wis/db';
import { TenantError, TenantErrorCode } from './errors';

type Db = NodePgDatabase<typeof schema>;
type TenantStatus = (typeof schema.tenantStatus.enumValues)[number];

export interface TenantOverview {
  tenantId: string;
  name: string;
  status: TenantStatus;
  maxSeats: number;
  seatsUsed: number;
  seatsReserved: number;
  modules: string[];
}

/** Statuses in which members may not use the app. */
export const BLOCKED_STATUSES: readonly TenantStatus[] = ['suspended', 'offboarding'];

export async function getTenantOverview(db: Db, tenantId: string): Promise<TenantOverview | null> {
  const [ent] = await db
    .select({
      name: schema.organization.name,
      status: schema.tenantEntitlements.status,
      maxSeats: schema.tenantEntitlements.maxSeats,
    })
    .from(schema.tenantEntitlements)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.tenantEntitlements.tenantId))
    .where(eq(schema.tenantEntitlements.tenantId, tenantId));
  if (!ent) return null;

  const [{ n: seatsUsed } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, tenantId));
  const [{ n: seatsReserved } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, tenantId),
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    );
  const modules = await db
    .select({ id: schema.tenantModules.moduleId })
    .from(schema.tenantModules)
    .where(eq(schema.tenantModules.tenantId, tenantId));

  return { tenantId, ...ent, seatsUsed, seatsReserved, modules: modules.map((m) => m.id) };
}

/**
 * Request-level gate: throws unless the tenant exists and its members may use the app.
 * Call it in every server entry point that acts on behalf of a tenant (pages, API routes).
 */
export async function assertTenantActive(db: Db, tenantId: string): Promise<TenantOverview> {
  const overview = await getTenantOverview(db, tenantId);
  if (!overview) throw new TenantError(TenantErrorCode.TENANT_NOT_PROVISIONED);
  if (BLOCKED_STATUSES.includes(overview.status))
    throw new TenantError(TenantErrorCode.TENANT_NOT_ACTIVE);
  return overview;
}

/** Whether a module is enabled for the tenant (pure; use on an already loaded overview). */
export const isModuleEnabled = (overview: Pick<TenantOverview, 'modules'>, moduleId: string) =>
  overview.modules.includes(moduleId);

/**
 * Entitlement gate for module routes and API endpoints: the tenant must be active AND have the
 * module enabled. API handlers should answer 404 on MODULE_NOT_ENABLED so disabled modules are
 * indistinguishable from non-existent ones.
 */
export async function assertModuleEnabled(
  db: Db,
  tenantId: string,
  moduleId: string,
): Promise<TenantOverview> {
  const overview = await assertTenantActive(db, tenantId);
  if (!isModuleEnabled(overview, moduleId))
    throw new TenantError(TenantErrorCode.MODULE_NOT_ENABLED);
  return overview;
}
