'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { linkEmployeeToUser, TenantError } from '@wis/auth';
import { withTenant } from '@wis/db';
import {
  createEmployee,
  PeopleError,
  requireCan,
  updateEmployee,
  type CreateEmployeeInput,
} from '@wis/people';
import { getRequestActor } from '@/lib/actor';
import { getAuthContext } from '@/lib/auth';

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; code: string; issues: { path: string; message: string }[] };

const fail = (code: string, issues: { path: string; message: string }[] = []): SaveResult => ({
  ok: false,
  code,
  issues,
});

export async function saveEmployeeAction(input: {
  id?: string;
  values: Record<string, unknown>;
}): Promise<SaveResult> {
  const ra = await getRequestActor();
  if (!ra) return fail('FORBIDDEN');
  const { appDb } = getAuthContext();
  try {
    const view = await withTenant(
      appDb,
      ra.tenantId,
      (tx) =>
        input.id
          ? updateEmployee(tx, ra.actor, input.id, input.values)
          : createEmployee(tx, ra.actor, input.values as CreateEmployeeInput), // validated by the service's Zod schema
    );
    revalidatePath('/[locale]/employees', 'layout');
    return { ok: true, id: view.id };
  } catch (e) {
    if (e instanceof PeopleError) return fail(e.code, e.issues);
    console.error('saveEmployeeAction failed', e instanceof Error ? e.message : e);
    return fail('generic');
  }
}

const linkInput = z.object({ employeeId: z.uuid(), userId: z.string().min(1).nullable() });

/** Links an employee to a login (or removes the link): this is what makes one person count once. */
export async function linkLoginAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const ra = await getRequestActor();
  if (!ra) return { ok: false, code: 'FORBIDDEN' };
  try {
    requireCan(ra.actor, 'employee', 'update');
    const input = linkInput.parse(raw);
    await linkEmployeeToUser(getAuthContext().db, {
      tenantId: ra.tenantId,
      employeeId: input.employeeId,
      userId: input.userId,
      actorUserId: ra.actor.userId,
    });
    revalidatePath('/[locale]/employees', 'layout');
    return { ok: true };
  } catch (e) {
    if (e instanceof PeopleError) return { ok: false, code: e.code };
    if (e instanceof TenantError) return { ok: false, code: e.code };
    if (e instanceof z.ZodError) return { ok: false, code: 'VALIDATION' };
    console.error('linkLoginAction failed', e instanceof Error ? e.message : e);
    return { ok: false, code: 'generic' };
  }
}
