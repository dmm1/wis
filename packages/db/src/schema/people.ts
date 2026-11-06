import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

/**
 * A person who can be scheduled. Not the same as a login: `user_id` is optional and links an
 * employee to the account they sign in with (one employee per account per tenant).
 * Tenant data: RLS isolates it; custom fields live in `custom_data`, validated against the tenant's
 * `field_definition` rows.
 */
export const employee = pgTable(
  'employee',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    personnelNumber: text('personnel_number'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    customData: jsonb('custom_data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('employee_tenant_name_idx').on(t.tenantId, t.lastName, t.firstName),
    index('employee_custom_data_gin').using('gin', sql`${t.customData} jsonb_path_ops`),
    uniqueIndex('employee_tenant_personnel_number_uniq')
      .on(t.tenantId, t.personnelNumber)
      .where(sql`${t.personnelNumber} IS NOT NULL`),
    uniqueIndex('employee_tenant_user_uniq')
      .on(t.tenantId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    check(
      'employee_dates_check',
      sql`${t.endDate} IS NULL OR ${t.startDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
    check('employee_custom_data_object', sql`jsonb_typeof(${t.customData}) = 'object'`),
    check('employee_custom_data_size', sql`octet_length(${t.customData}::text) <= 16384`),
  ],
);

/** A tenant-defined extra field on an extensible entity. Key and type never change once created. */
export const fieldDefinition = pgTable(
  'field_definition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    type: text('type').notNull(),
    label: jsonb('label').notNull(),
    required: boolean('required').notNull().default(false),
    sensitive: boolean('sensitive').notNull().default(false),
    section: text('section'),
    sortOrder: integer('sort_order').notNull().default(0),
    options: jsonb('options').notNull().default([]),
    validation: jsonb('validation').notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('field_definition_tenant_entity_key_uniq').on(t.tenantId, t.entity, t.key),
    index('field_definition_tenant_entity_idx').on(t.tenantId, t.entity, t.sortOrder),
    check(
      'field_definition_type_check',
      sql`${t.type} IN ('text','number','date','boolean','select','multi_select')`,
    ),
  ],
);

/**
 * Daily billable headcount per tenant and category (architecture §4.3). Written by the platform
 * (owner connection); never reachable by tenant code.
 */
export const usageSnapshots = pgTable(
  'usage_snapshots',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    category: text('category').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.day, t.category] }),
    check(
      'usage_snapshots_category_check',
      sql`${t.category} IN ('employee_with_login','employee_no_login','user_only')`,
    ),
  ],
);
