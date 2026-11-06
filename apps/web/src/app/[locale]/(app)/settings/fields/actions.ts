'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@wis/db';
import {
  createFieldDefinition,
  PeopleError,
  setFieldArchived,
  updateFieldDefinition,
  type FieldDefinitionPatch,
} from '@wis/people';
import type { FieldDefinitionInput } from '@wis/core';
import { getRequestActor } from '@/lib/actor';
import { getAuthContext } from '@/lib/auth';

export type FieldResult =
  { ok: true } | { ok: false; code: string; issues: { path: string; message: string }[] };
const fail = (code: string, issues: { path: string; message: string }[] = []): FieldResult => ({
  ok: false,
  code,
  issues,
});

async function run(
  fn: (
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
    ra: NonNullable<Awaited<ReturnType<typeof getRequestActor>>>,
  ) => Promise<unknown>,
): Promise<FieldResult> {
  const ra = await getRequestActor();
  if (!ra) return fail('FORBIDDEN');
  try {
    await withTenant(getAuthContext().appDb, ra.tenantId, (tx) => fn(tx, ra));
    revalidatePath('/[locale]/settings/fields', 'page');
    revalidatePath('/[locale]/employees', 'layout');
    return { ok: true };
  } catch (e) {
    if (e instanceof PeopleError) return fail(e.code, e.issues);
    if (e instanceof z.ZodError) return fail('VALIDATION');
    console.error('field action failed', e instanceof Error ? e.message : e);
    return fail('generic');
  }
}

export async function createFieldAction(input: FieldDefinitionInput): Promise<FieldResult> {
  return run((tx, ra) => createFieldDefinition(tx, ra.actor, input));
}

export async function updateFieldAction(input: {
  id: string;
  patch: FieldDefinitionPatch;
}): Promise<FieldResult> {
  return run((tx, ra) =>
    updateFieldDefinition(tx, ra.actor, z.uuid().parse(input.id), input.patch),
  );
}

export async function archiveFieldAction(input: {
  id: string;
  archived: boolean;
}): Promise<FieldResult> {
  return run((tx, ra) =>
    setFieldArchived(tx, ra.actor, z.uuid().parse(input.id), Boolean(input.archived)),
  );
}
