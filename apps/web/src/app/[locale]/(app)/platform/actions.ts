'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  provisionTenant,
  resendInvitation,
  setTenantStatus,
  TenantError,
  updateTenantEntitlements,
} from '@wis/auth';
import { getAuthContext } from '@/lib/auth';
import { requirePlatformAdmin } from '@/lib/session';

export type ActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; code: string; field?: string };

/** Runs a platform action: re-checks the role on the server and maps domain errors to codes. */
async function run<T>(
  fn: (actorId: string) => Promise<T>,
): Promise<ActionResult<T extends object ? T : object>> {
  let actor: { id: string };
  try {
    actor = await requirePlatformAdmin();
  } catch {
    return { ok: false, code: 'FORBIDDEN' };
  }
  try {
    const value = await fn(actor.id);
    return { ok: true, ...((value ?? {}) as object) } as ActionResult<
      T extends object ? T : object
    >;
  } catch (e) {
    if (e instanceof TenantError) return { ok: false, code: e.code };
    if (e instanceof z.ZodError)
      return { ok: false, code: 'VALIDATION', field: String(e.issues[0]?.path[0] ?? '') };
    // Unique slug violation on organization.slug
    if ((e as { cause?: { code?: string } }).cause?.code === '23505')
      return { ok: false, code: 'SLUG_TAKEN', field: 'slug' };
    console.error('platform action failed', e instanceof Error ? e.message : e);
    return { ok: false, code: 'generic' };
  }
}

export async function createTenantAction(raw: unknown) {
  return run(async (actorUserId) => {
    const { db, mailer, baseURL } = getAuthContext();
    const result = await provisionTenant({ db, mailer, baseURL }, {
      ...(raw as object),
      actorUserId,
    } as never);
    revalidatePath('/[locale]/platform', 'page');
    return { tenantId: result.tenantId, emailSent: result.emailSent };
  });
}

const statusInput = z.object({
  tenantId: z.string().min(1),
  status: z.enum(['trial', 'active', 'suspended', 'offboarding']),
});

export async function setStatusAction(raw: unknown) {
  return run(async (actorUserId) => {
    const input = statusInput.parse(raw);
    await setTenantStatus({ db: getAuthContext().db }, { ...input, actorUserId });
    revalidatePath('/[locale]/platform', 'layout');
  });
}

export async function updateSeatsAction(raw: unknown) {
  return run(async (actorUserId) => {
    const input = z
      .object({ tenantId: z.string().min(1), maxSeats: z.number().int().min(1).max(100_000) })
      .parse(raw);
    await updateTenantEntitlements(getAuthContext().db, { ...input, actorUserId });
    revalidatePath('/[locale]/platform', 'layout');
  });
}

export async function updateModulesAction(raw: unknown) {
  return run(async (actorUserId) => {
    const input = z
      .object({ tenantId: z.string().min(1), modules: z.array(z.string()) })
      .parse(raw);
    await updateTenantEntitlements(getAuthContext().db, { ...input, actorUserId });
    revalidatePath('/[locale]/platform', 'layout');
  });
}

export async function resendInvitationAction(raw: unknown) {
  return run(async (actorUserId) => {
    const input = z.object({ invitationId: z.string().min(1) }).parse(raw);
    const { db, mailer, baseURL } = getAuthContext();
    const r = await resendInvitation(
      { db, mailer, baseURL },
      { invitationId: input.invitationId, actorUserId },
    );
    revalidatePath('/[locale]/platform', 'layout');
    return r;
  });
}
