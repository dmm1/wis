import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  fieldDefinitionInputSchema,
  type FieldDefinition,
  type FieldDefinitionInput,
} from '@wis/core';
import { schema, writeAudit, type Tx } from '@wis/db';
import { registry } from '@wis/modules';
import { requireCan, type Actor } from './actor';
import { mapDbError, PeopleError, toIssue } from './errors';

/** Upper bound per tenant and entity: keeps forms usable and `custom_data` small. */
export const MAX_FIELDS_PER_ENTITY = 50;

/** Managing field definitions is a tenant-administration task. */
const MANAGE = ['organization', 'update'] as const;

type Row = typeof schema.fieldDefinition.$inferSelect;

function toDefinition(r: Row): FieldDefinition {
  // Stored data was validated on the way in; parsing again guards against drift.
  const parsed = fieldDefinitionInputSchema.parse({
    entity: r.entity,
    key: r.key,
    type: r.type,
    label: r.label,
    required: r.required,
    sensitive: r.sensitive,
    section: r.section,
    sortOrder: r.sortOrder,
    options: r.options,
    validation: r.validation,
  });
  return { ...parsed, id: r.id, archivedAt: r.archivedAt };
}

function assertKnownEntity(entity: string) {
  if (!registry.extensibleEntityIds().includes(entity)) throw new PeopleError('UNKNOWN_ENTITY');
}

const toIssues = (e: z.ZodError) => e.issues.map(toIssue);

/** Active definitions (and archived ones when asked) of an entity, in display order. */
export async function listFieldDefinitions(
  tx: Tx,
  tenantId: string,
  entity: string,
  opts: { includeArchived?: boolean } = {},
): Promise<FieldDefinition[]> {
  const rows = await tx
    .select()
    .from(schema.fieldDefinition)
    .where(
      and(eq(schema.fieldDefinition.tenantId, tenantId), eq(schema.fieldDefinition.entity, entity)),
    )
    .orderBy(asc(schema.fieldDefinition.sortOrder), asc(schema.fieldDefinition.createdAt));
  const defs = rows.map(toDefinition);
  return opts.includeArchived ? defs : defs.filter((d) => !d.archivedAt);
}

export async function createFieldDefinition(
  tx: Tx,
  actor: Actor,
  raw: FieldDefinitionInput,
): Promise<FieldDefinition> {
  requireCan(actor, ...MANAGE);
  const parsed = fieldDefinitionInputSchema.safeParse(raw);
  if (!parsed.success) throw new PeopleError('VALIDATION', toIssues(parsed.error));
  const input = parsed.data;
  assertKnownEntity(input.entity);

  const existing = await listFieldDefinitions(tx, actor.tenantId, input.entity, {
    includeArchived: true,
  });
  if (existing.length >= MAX_FIELDS_PER_ENTITY) throw new PeopleError('TOO_MANY_FIELDS');

  try {
    const [row] = await tx
      .insert(schema.fieldDefinition)
      .values({
        tenantId: actor.tenantId,
        entity: input.entity,
        key: input.key,
        type: input.type,
        label: input.label,
        required: input.required,
        sensitive: input.sensitive,
        section: input.section,
        sortOrder: input.sortOrder,
        options: input.options,
        validation: input.validation,
      })
      .returning();
    await writeAudit(tx, {
      tenantId: actor.tenantId,
      actorType: 'user',
      actorId: actor.userId,
      action: 'field.created',
      targetType: 'field_definition',
      targetId: row!.id,
      metadata: {
        entity: input.entity,
        key: input.key,
        type: input.type,
        sensitive: input.sensitive,
      },
    });
    return toDefinition(row!);
  } catch (e) {
    return mapDbError(e, { field_definition_tenant_entity_key_uniq: 'DUPLICATE_KEY' });
  }
}

/** What may change after creation. Key and type are fixed because stored values depend on them. */
export type FieldDefinitionPatch = Partial<
  Pick<
    FieldDefinitionInput,
    'label' | 'required' | 'sensitive' | 'section' | 'sortOrder' | 'options' | 'validation'
  >
> & { key?: never; type?: never; entity?: never };

export async function updateFieldDefinition(
  tx: Tx,
  actor: Actor,
  id: string,
  patch: FieldDefinitionPatch,
): Promise<FieldDefinition> {
  requireCan(actor, ...MANAGE);
  const forbidden = ['key', 'type', 'entity'].filter((k) => k in (patch as object));
  if (forbidden.length)
    throw new PeopleError(
      'IMMUTABLE_FIELD',
      forbidden.map((path) => ({ path, message: 'cannot be changed' })),
    );

  const [row] = await tx
    .select()
    .from(schema.fieldDefinition)
    .where(
      and(eq(schema.fieldDefinition.id, id), eq(schema.fieldDefinition.tenantId, actor.tenantId)),
    )
    .for('update');
  if (!row) throw new PeopleError('NOT_FOUND');
  const current = toDefinition(row);

  const merged = { ...current, ...patch };
  const parsed = fieldDefinitionInputSchema.safeParse(merged);
  if (!parsed.success) throw new PeopleError('VALIDATION', toIssues(parsed.error));
  const next = parsed.data;

  // Options may be added or relabelled, never removed: stored values would silently become invalid.
  const kept = new Set(next.options.map((o) => o.value));
  const removed = current.options.filter((o) => !kept.has(o.value));
  if (removed.length)
    throw new PeopleError(
      'OPTION_REMOVED',
      removed.map((o) => ({ path: 'options', message: o.value })),
    );

  const [updated] = await tx
    .update(schema.fieldDefinition)
    .set({
      label: next.label,
      required: next.required,
      sensitive: next.sensitive,
      section: next.section,
      sortOrder: next.sortOrder,
      options: next.options,
      validation: next.validation,
      updatedAt: new Date(),
    })
    .where(eq(schema.fieldDefinition.id, id))
    .returning();
  await writeAudit(tx, {
    tenantId: actor.tenantId,
    actorType: 'user',
    actorId: actor.userId,
    action: 'field.updated',
    targetType: 'field_definition',
    targetId: id,
    metadata: { entity: current.entity, key: current.key, changed: Object.keys(patch) },
  });
  return toDefinition(updated!);
}

/** Hides a field from forms. Values already stored are kept and come back if the field is restored. */
export async function setFieldArchived(
  tx: Tx,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<void> {
  requireCan(actor, ...MANAGE);
  const res = await tx
    .update(schema.fieldDefinition)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(
      and(eq(schema.fieldDefinition.id, id), eq(schema.fieldDefinition.tenantId, actor.tenantId)),
    )
    .returning({ entity: schema.fieldDefinition.entity, key: schema.fieldDefinition.key });
  if (res.length === 0) throw new PeopleError('NOT_FOUND');
  await writeAudit(tx, {
    tenantId: actor.tenantId,
    actorType: 'user',
    actorId: actor.userId,
    action: archived ? 'field.archived' : 'field.restored',
    targetType: 'field_definition',
    targetId: id,
    metadata: res[0]!,
  });
}
