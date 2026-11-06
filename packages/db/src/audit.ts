import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;
type Executor = Pick<Db, 'insert'>;

export interface AuditEntry {
  /** NULL for platform-level actions. */
  tenantId: string | null;
  actorType: 'user' | 'platform' | 'system' | 'api_key';
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Keep free of secrets and unnecessary personal data. */
  metadata?: Record<string, unknown>;
}

/** Appends to the audit log. Pass a transaction to make the entry atomic with the change. */
export async function writeAudit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    tenantId: entry.tenantId,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  });
}
