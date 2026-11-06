import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { billingConfigSchema } from '@wis/core';
import { schema } from '@wis/db';
import { writeAudit } from '@wis/db';
import { TenantError, TenantErrorCode, toTenantError } from './errors';
import type { Mailer } from './mailer';
import { CREATOR_ROLE } from './permissions';
import { invitationEmail, toMailLocale } from './templates';

type Db = NodePgDatabase<typeof schema>;
type TenantStatus = (typeof schema.tenantStatus.enumValues)[number];

/** Platform-only operations. Callers must already have verified the actor is a platform admin. */
export interface PlatformDeps {
  db: Db;
  mailer: Mailer;
  baseURL: string;
}

export const provisionTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/,
      'lowercase letters, digits and dashes (3-50 chars)',
    ),
  adminEmail: z.email().transform((e) => e.toLowerCase()),
  maxSeats: z.number().int().min(1).max(100_000),
  modules: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).default([]),
  billing: billingConfigSchema.default(() => billingConfigSchema.parse({})),
  /** Language of the invitation e-mail. */
  locale: z.enum(['en', 'de']).default('en'),
  trialDays: z.number().int().min(0).max(365).optional(),
  /** Platform admin performing the action (becomes inviter + audit actor). */
  actorUserId: z.string().min(1),
});
export type ProvisionTenantInput = z.input<typeof provisionTenantSchema>;

export interface ProvisionTenantResult {
  tenantId: string;
  invitationId: string;
  /** False if the tenant was created but the e-mail could not be sent: resend the invitation. */
  emailSent: boolean;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Creates a tenant (organization) with entitlements, enabled modules and a pending
 * invitation for its first customer-admin, atomically. The invitee signs up / signs in and
 * accepts the invitation; the seat is reserved by the invitation.
 */
export async function provisionTenant(
  deps: PlatformDeps,
  rawInput: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  const input = provisionTenantSchema.parse(rawInput);
  const tenantId = randomUUID();
  const invitationId = randomUUID();

  const inviter = await deps.db
    .select({ name: schema.user.name, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, input.actorUserId))
    .then((r) => r[0]);
  if (!inviter || !(inviter.role ?? '').split(',').includes('admin')) {
    throw new Error('Actor is not a platform admin');
  }

  try {
    await deps.db.transaction(async (tx) => {
      await tx.insert(schema.organization).values({
        id: tenantId,
        name: input.name,
        slug: input.slug,
        createdAt: new Date(),
        metadata: JSON.stringify({ locale: input.locale }),
      });
      await tx.insert(schema.tenantEntitlements).values({
        tenantId,
        maxSeats: input.maxSeats,
        billing: input.billing,
        status: input.trialDays === 0 ? 'active' : 'trial',
        trialEndsAt: input.trialDays ? new Date(Date.now() + input.trialDays * 86_400_000) : null,
      });
      if (input.modules.length) {
        await tx
          .insert(schema.tenantModules)
          .values(input.modules.map((moduleId) => ({ tenantId, moduleId })));
      }
      await tx.insert(schema.invitation).values({
        id: invitationId,
        organizationId: tenantId,
        email: input.adminEmail,
        role: CREATOR_ROLE,
        status: 'pending',
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        inviterId: input.actorUserId,
      });
      await writeAudit(tx, {
        tenantId,
        actorType: 'platform',
        actorId: input.actorUserId,
        action: 'tenant.provisioned',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: { slug: input.slug, maxSeats: input.maxSeats, modules: input.modules },
      });
    });
  } catch (e) {
    throw toTenantError(e) ?? e;
  }

  let emailSent = true;
  try {
    await deps.mailer.send(
      invitationEmail(input.locale, {
        to: input.adminEmail,
        inviterName: inviter.name,
        organizationName: input.name,
        url: `${deps.baseURL}/accept-invitation/${invitationId}`,
      }),
    );
  } catch {
    emailSent = false;
  }
  return { tenantId, invitationId, emailSent };
}

const ALLOWED_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  trial: ['active', 'suspended', 'offboarding'],
  active: ['suspended', 'offboarding'],
  suspended: ['active', 'offboarding'],
  offboarding: [],
};

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Moves a tenant through its lifecycle (trial → active → suspended → offboarding), audited. */
export async function setTenantStatus(
  deps: Pick<PlatformDeps, 'db'>,
  p: { tenantId: string; status: TenantStatus; actorUserId: string; reason?: string },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: schema.tenantEntitlements.status })
      .from(schema.tenantEntitlements)
      .where(eq(schema.tenantEntitlements.tenantId, p.tenantId))
      .for('update');
    if (!row) throw new TenantError(TenantErrorCode.TENANT_NOT_PROVISIONED);
    if (!canTransition(row.status, p.status)) {
      throw new TenantError(
        TenantErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot change tenant status from ${row.status} to ${p.status}`,
      );
    }
    await tx
      .update(schema.tenantEntitlements)
      .set({ status: p.status, updatedAt: new Date() })
      .where(eq(schema.tenantEntitlements.tenantId, p.tenantId));
    await writeAudit(tx, {
      tenantId: p.tenantId,
      actorType: 'platform',
      actorId: p.actorUserId,
      action: 'tenant.status_changed',
      targetType: 'tenant',
      targetId: p.tenantId,
      metadata: { from: row.status, to: p.status, ...(p.reason ? { reason: p.reason } : {}) },
    });
  });
}

export { toMailLocale };

/**
 * Creates a platform admin (global operator). Used by the bootstrap script, because open
 * sign-up is closed. The e-mail is marked verified; enforce 2FA for this account afterwards.
 */
export async function createPlatformAdmin(
  deps: { auth: import('./auth').Auth; db: Db },
  p: { email: string; name: string; password: string },
): Promise<{ userId: string }> {
  const ctx = await deps.auth.$context;
  if (p.password.length < ctx.password.config.minPasswordLength) {
    throw new Error(
      `Password must be at least ${ctx.password.config.minPasswordLength} characters`,
    );
  }
  const email = z.email().parse(p.email).toLowerCase();
  const [existing] = await deps.db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (existing) throw new Error('A user with this e-mail already exists');

  const user = await ctx.internalAdapter.createUser(
    { email, name: p.name.trim() || email, emailVerified: true, role: 'admin' },
    { method: 'admin' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(p.password),
  });
  await writeAudit(deps.db, {
    tenantId: null,
    actorType: 'system',
    action: 'platform.admin_bootstrapped',
    targetType: 'user',
    targetId: user.id,
  });
  return { userId: user.id };
}
