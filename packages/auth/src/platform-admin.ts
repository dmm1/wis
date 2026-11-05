import { and, count, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { registry } from '@wis/modules';
import { schema } from '@wis/db';
import { writeAudit } from './audit';
import { TenantError, TenantErrorCode } from './errors';
import type { Mailer } from './mailer';
import { invitationEmail, toMailLocale } from './templates';
import type { PlatformDeps } from './platform';

type Db = NodePgDatabase<typeof schema>;
type TenantStatus = (typeof schema.tenantStatus.enumValues)[number];

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  maxSeats: number;
  seatsUsed: number;
  seatsReserved: number;
  modules: string[];
  createdAt: Date;
}

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(schema.tenantStatus.enumValues).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Tenants for the platform overview, newest first, with seat usage and enabled modules. */
export async function listTenants(db: Db, raw: z.input<typeof listQuery> = {}) {
  const q = listQuery.parse(raw);
  const filters = [
    q.status ? eq(schema.tenantEntitlements.status, q.status) : undefined,
    q.search
      ? or(
          ilike(schema.organization.name, `%${q.search.replace(/[%_]/g, '\\$&')}%`),
          ilike(schema.organization.slug, `%${q.search.replace(/[%_]/g, '\\$&')}%`),
        )
      : undefined,
  ].filter(Boolean);

  const where = filters.length ? and(...filters) : undefined;
  const rows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      status: schema.tenantEntitlements.status,
      maxSeats: schema.tenantEntitlements.maxSeats,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.tenantEntitlements)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.tenantEntitlements.tenantId))
    .where(where)
    .orderBy(desc(schema.organization.createdAt))
    .limit(q.limit)
    .offset(q.offset);
  const [{ n: total } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.tenantEntitlements)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.tenantEntitlements.tenantId))
    .where(where);

  const ids = rows.map((r) => r.id);
  const members = ids.length
    ? await db
        .select({ id: schema.member.organizationId, n: count() })
        .from(schema.member)
        .where(inArray(schema.member.organizationId, ids))
        .groupBy(schema.member.organizationId)
    : [];
  const pending = ids.length
    ? await db
        .select({ id: schema.invitation.organizationId, n: count() })
        .from(schema.invitation)
        .where(
          and(
            inArray(schema.invitation.organizationId, ids),
            eq(schema.invitation.status, 'pending'),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        )
        .groupBy(schema.invitation.organizationId)
    : [];
  const mods = ids.length
    ? await db
        .select()
        .from(schema.tenantModules)
        .where(inArray(schema.tenantModules.tenantId, ids))
    : [];

  const items: TenantListItem[] = rows.map((r) => ({
    ...r,
    seatsUsed: members.find((m) => m.id === r.id)?.n ?? 0,
    seatsReserved: pending.find((m) => m.id === r.id)?.n ?? 0,
    modules: mods.filter((m) => m.tenantId === r.id).map((m) => m.moduleId),
  }));
  return { items, total };
}

export async function getTenantDetail(db: Db, tenantId: string) {
  const [base] = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      createdAt: schema.organization.createdAt,
      status: schema.tenantEntitlements.status,
      maxSeats: schema.tenantEntitlements.maxSeats,
      billing: schema.tenantEntitlements.billing,
      trialEndsAt: schema.tenantEntitlements.trialEndsAt,
    })
    .from(schema.tenantEntitlements)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.tenantEntitlements.tenantId))
    .where(eq(schema.tenantEntitlements.tenantId, tenantId));
  if (!base) return null;

  const members = await db
    .select({
      userId: schema.member.userId,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
      joinedAt: schema.member.createdAt,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, tenantId))
    .orderBy(schema.member.createdAt);
  const invitations = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      expiresAt: schema.invitation.expiresAt,
    })
    .from(schema.invitation)
    .where(
      and(eq(schema.invitation.organizationId, tenantId), eq(schema.invitation.status, 'pending')),
    )
    .orderBy(desc(schema.invitation.createdAt));
  const modules = (
    await db
      .select({ id: schema.tenantModules.moduleId })
      .from(schema.tenantModules)
      .where(eq(schema.tenantModules.tenantId, tenantId))
  ).map((m) => m.id);
  const activity = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.tenantId, tenantId))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(20);

  const now = new Date();
  return {
    ...base,
    modules,
    members,
    invitations: invitations.map((i) => ({ ...i, expired: i.expiresAt <= now })),
    seatsUsed: members.length,
    seatsReserved: invitations.filter((i) => i.expiresAt > now).length,
    activity,
  };
}

export const updateEntitlementsSchema = z.object({
  tenantId: z.string().min(1),
  maxSeats: z.number().int().min(1).max(100_000).optional(),
  /** Full list of enabled module ids (replaces the current list). */
  modules: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).optional(),
  actorUserId: z.string().min(1),
});

/**
 * Changes a tenant's seat limit and/or enabled modules (platform only), audited, row-locked.
 * Seats can't go below current usage (members + open invitations); only modules compiled into this
 * deployment can be enabled. Disabling a module hides it; its data stays.
 */
export async function updateTenantEntitlements(
  db: Db,
  raw: z.input<typeof updateEntitlementsSchema>,
) {
  const input = updateEntitlementsSchema.parse(raw);
  if (input.modules) {
    const unknown = input.modules.filter((m) => !registry.has(m));
    if (unknown.length)
      throw new TenantError(
        TenantErrorCode.UNKNOWN_MODULE,
        `Unknown module: ${unknown.join(', ')}`,
      );
  }
  await db.transaction(async (tx) => {
    const [ent] = await tx
      .select()
      .from(schema.tenantEntitlements)
      .where(eq(schema.tenantEntitlements.tenantId, input.tenantId))
      .for('update');
    if (!ent) throw new TenantError(TenantErrorCode.TENANT_NOT_PROVISIONED);

    if (input.maxSeats !== undefined && input.maxSeats !== ent.maxSeats) {
      const [{ n: members } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, input.tenantId));
      const [{ n: pending } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.organizationId, input.tenantId),
            eq(schema.invitation.status, 'pending'),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        );
      if (input.maxSeats < members + pending)
        throw new TenantError(TenantErrorCode.SEATS_BELOW_USAGE);
      await tx
        .update(schema.tenantEntitlements)
        .set({ maxSeats: input.maxSeats, updatedAt: new Date() })
        .where(eq(schema.tenantEntitlements.tenantId, input.tenantId));
      await writeAudit(tx, {
        tenantId: input.tenantId,
        actorType: 'platform',
        actorId: input.actorUserId,
        action: 'tenant.seats_changed',
        targetType: 'tenant',
        targetId: input.tenantId,
        metadata: { from: ent.maxSeats, to: input.maxSeats },
      });
    }

    if (input.modules) {
      const current = (
        await tx
          .select({ id: schema.tenantModules.moduleId })
          .from(schema.tenantModules)
          .where(eq(schema.tenantModules.tenantId, input.tenantId))
      ).map((m) => m.id);
      const next = new Set(input.modules);
      const added = [...next].filter((m) => !current.includes(m));
      const removed = current.filter((m) => !next.has(m));
      if (removed.length) {
        await tx
          .delete(schema.tenantModules)
          .where(
            and(
              eq(schema.tenantModules.tenantId, input.tenantId),
              inArray(schema.tenantModules.moduleId, removed),
            ),
          );
      }
      if (added.length) {
        await tx
          .insert(schema.tenantModules)
          .values(added.map((moduleId) => ({ tenantId: input.tenantId, moduleId })));
      }
      if (added.length || removed.length) {
        await tx
          .update(schema.tenantEntitlements)
          .set({ updatedAt: sql`now()` })
          .where(eq(schema.tenantEntitlements.tenantId, input.tenantId));
        await writeAudit(tx, {
          tenantId: input.tenantId,
          actorType: 'platform',
          actorId: input.actorUserId,
          action: 'tenant.modules_changed',
          targetType: 'tenant',
          targetId: input.tenantId,
          metadata: { added, removed },
        });
      }
    }
  });
}

/** Extends a pending invitation by 7 days and sends the e-mail again. */
export async function resendInvitation(
  deps: PlatformDeps,
  p: { invitationId: string; actorUserId: string },
): Promise<{ emailSent: boolean }> {
  const [row] = await deps.db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      status: schema.invitation.status,
      organizationId: schema.invitation.organizationId,
      organizationName: schema.organization.name,
      metadata: schema.organization.metadata,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .where(eq(schema.invitation.id, p.invitationId));
  if (!row || row.status !== 'pending')
    throw new TenantError(TenantErrorCode.INVITATION_NOT_PENDING);

  await deps.db
    .update(schema.invitation)
    .set({ expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) })
    .where(eq(schema.invitation.id, row.id));
  await writeAudit(deps.db, {
    tenantId: row.organizationId,
    actorType: 'platform',
    actorId: p.actorUserId,
    action: 'invitation.resent',
    targetType: 'invitation',
    targetId: row.id,
  });

  const [actor] = await deps.db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, p.actorUserId));
  let locale: 'en' | 'de' = 'en';
  try {
    locale = toMailLocale((JSON.parse(row.metadata ?? '{}') as { locale?: unknown }).locale);
  } catch {
    /* default */
  }
  try {
    await (deps.mailer as Mailer).send(
      invitationEmail(locale, {
        to: row.email,
        inviterName: actor?.name ?? 'WIS',
        organizationName: row.organizationName,
        url: `${deps.baseURL}/accept-invitation/${row.id}`,
      }),
    );
    return { emailSent: true };
  } catch {
    return { emailSent: false };
  }
}
