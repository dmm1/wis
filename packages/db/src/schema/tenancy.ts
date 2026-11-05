import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization } from './auth';

export const tenantStatus = pgEnum('tenant_status', [
  'trial',
  'active',
  'suspended',
  'offboarding',
]);

/**
 * Platform-managed settings per tenant. Written only by the platform (owner connection);
 * tenants may read their own row (RLS) but never change it.
 */
export const tenantEntitlements = pgTable(
  'tenant_entitlements',
  {
    tenantId: text('tenant_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    status: tenantStatus('status').notNull().default('trial'),
    /** Maximum billable people (see architecture §4.3). Enforced by DB trigger. */
    maxSeats: integer('max_seats').notNull().default(5),
    /** Validated by billingConfigSchema in @wis/core. */
    billing: jsonb('billing').notNull().default({}),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('tenant_entitlements_max_seats_check', sql`${t.maxSeats} >= 0`)],
);

/** Modules enabled for a tenant. Disabled/absent module = not routable for that tenant. */
export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    moduleId: text('module_id').notNull(),
    config: jsonb('config').notNull().default({}),
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.moduleId] })],
);

/**
 * Append-only audit trail. `tenant_id` is NULL for platform-level actions. No foreign key on purpose:
 * the trail must survive tenant deletion until the retention purge.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
    check(
      'audit_log_actor_type_check',
      sql`${t.actorType} IN ('user','platform','system','api_key')`,
    ),
  ],
);
