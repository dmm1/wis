import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { BLOCKED_STATUSES } from '@wis/auth';
import type { Actor } from '@wis/people';
import { getAuthContext } from './auth';
import { getAppContext, type AppContext } from './session';

/** The permission questions the people screens ask. Asked once per request. */
const CHECKS: [string, string][] = [
  ['employee', 'read'],
  ['employee', 'create'],
  ['employee', 'update'],
  ['employee', 'read-sensitive'],
  ['organization', 'update'],
];

export interface RequestActor {
  actor: Actor;
  ctx: AppContext;
  tenantId: string;
}

/**
 * The acting person for the active workspace, or null when signed out, without a usable workspace,
 * or when the workspace is paused. Permissions come from better-auth, so tenant-defined (dynamic)
 * roles are honoured, not just the system roles.
 */
export const getRequestActor = cache(async (): Promise<RequestActor | null> => {
  const ctx = await getAppContext();
  if (!ctx?.activeId || !ctx.tenant || BLOCKED_STATUSES.includes(ctx.tenant.status)) return null;
  const { auth } = getAuthContext();
  const h = await headers();

  const answers = await Promise.all(
    CHECKS.map(async ([resource, action]) => {
      const res = await auth.api
        .hasPermission({ headers: h, body: { permissions: { [resource]: [action] } as never } })
        .catch(() => null);
      return [`${resource}:${action}`, Boolean(res?.success)] as const;
    }),
  );
  const allowed = new Map(answers);
  return {
    ctx,
    tenantId: ctx.activeId,
    actor: {
      userId: ctx.user.id,
      tenantId: ctx.activeId,
      can: (resource, action) => allowed.get(`${resource}:${action}`) === true,
    },
  };
});
