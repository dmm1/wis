import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema, writeAudit } from '@wis/db';
import { TenantError, TenantErrorCode, toTenantError } from './errors';

type Db = NodePgDatabase<typeof schema>;

/**
 * Links an employee to the login they use (or unlinks with `userId: null`). This is what makes a
 * person count once: an employee with a login is one billable person, not an employee plus a user.
 *
 * Runs on the owner connection because it must check tenant membership, which tenant code cannot see.
 * The caller decides who may do this (customer admin / HR) before calling.
 */
export async function linkEmployeeToUser(
  db: Db,
  p: { tenantId: string; employeeId: string; userId: string | null; actorUserId: string },
): Promise<void> {
  await db
    .transaction(async (tx) => {
      const [emp] = await tx
        .select({ id: schema.employee.id, userId: schema.employee.userId })
        .from(schema.employee)
        .where(and(eq(schema.employee.id, p.employeeId), eq(schema.employee.tenantId, p.tenantId)))
        .for('update');
      if (!emp) throw new TenantError(TenantErrorCode.EMPLOYEE_NOT_FOUND);

      if (p.userId !== null) {
        const [member] = await tx
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(eq(schema.member.organizationId, p.tenantId), eq(schema.member.userId, p.userId)),
          );
        if (!member) throw new TenantError(TenantErrorCode.NOT_A_MEMBER);
        const [other] = await tx
          .select({ id: schema.employee.id })
          .from(schema.employee)
          .where(
            and(eq(schema.employee.tenantId, p.tenantId), eq(schema.employee.userId, p.userId)),
          );
        if (other && other.id !== emp.id) throw new TenantError(TenantErrorCode.ALREADY_LINKED);
      }

      await tx
        .update(schema.employee)
        .set({ userId: p.userId, updatedAt: new Date() })
        .where(eq(schema.employee.id, p.employeeId));
      await writeAudit(tx, {
        tenantId: p.tenantId,
        actorType: 'user',
        actorId: p.actorUserId,
        action: p.userId ? 'employee.login_linked' : 'employee.login_unlinked',
        targetType: 'employee',
        targetId: p.employeeId,
        metadata: p.userId ? { userId: p.userId } : {},
      });
    })
    .catch((e: unknown) => {
      throw toTenantError(e) ?? e;
    });
}

/** Members of the tenant who are not linked to an employee yet (candidates for linking). */
export async function listLinkableMembers(db: Db, tenantId: string) {
  const members = await db
    .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, tenantId))
    .orderBy(schema.user.name);
  const linked = await db
    .select({ userId: schema.employee.userId })
    .from(schema.employee)
    .where(eq(schema.employee.tenantId, tenantId));
  const taken = new Set(linked.map((l) => l.userId).filter(Boolean));
  return members.filter((m) => !taken.has(m.userId));
}

/** The account linked to an employee, if any. */
export async function getEmployeeLogin(db: Db, tenantId: string, employeeId: string) {
  const [row] = await db
    .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.employee)
    .innerJoin(schema.user, eq(schema.user.id, schema.employee.userId))
    .where(and(eq(schema.employee.id, employeeId), eq(schema.employee.tenantId, tenantId)));
  return row ?? null;
}
