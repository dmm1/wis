import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getTenantOverview, pendingInvitationsFor, type TenantOverview } from '@wis/auth';
import { getAuthContext } from './auth';

export const getSession = cache(async () => {
  const { auth } = getAuthContext();
  return auth.api.getSession({ headers: await headers() });
});

export const getWorkspaces = cache(async () => {
  const { auth } = getAuthContext();
  return auth.api.listOrganizations({ headers: await headers() });
});

export interface AppContext {
  user: { id: string; name: string; email: string; role: string | null; twoFactorEnabled: boolean };
  workspaces: { id: string; name: string }[];
  /** Selected workspace the user is a member of, or null (platform admin / not chosen yet). */
  activeId: string | null;
  /** Role of the user in the active workspace. */
  memberRole: string | null;
  tenant: TenantOverview | null;
  isPlatformAdmin: boolean;
  /** Open invitations for this e-mail; only loaded while the user has no workspace. */
  pendingInvitations: { id: string; name: string }[];
}

/** Everything the app shell needs, resolved once per request. Returns null when signed out. */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const { auth, db } = getAuthContext();

  const workspaces = (await getWorkspaces()).map((o) => ({ id: o.id, name: o.name }));
  const requested = session.session.activeOrganizationId ?? null;
  const activeId = requested && workspaces.some((w) => w.id === requested) ? requested : null;

  let memberRole: string | null = null;
  let tenant: TenantOverview | null = null;
  if (activeId) {
    const active = await auth.api
      .getActiveMemberRole({ headers: await headers() })
      .catch(() => null);
    memberRole = active?.role ?? null;
    tenant = await getTenantOverview(db, activeId);
  }

  const pendingInvitations =
    workspaces.length === 0
      ? (await pendingInvitationsFor(db, session.user.email)).map((i) => ({
          id: i.id,
          name: i.organizationName,
        }))
      : [];

  const u = session.user as typeof session.user & {
    role?: string | null;
    twoFactorEnabled?: boolean | null;
  };
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? null,
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
    },
    workspaces,
    activeId,
    memberRole,
    tenant,
    isPlatformAdmin: (u.role ?? '').split(',').includes('admin'),
    pendingInvitations,
  };
});

/**
 * Guard for platform-only server actions and pages. Always re-checks the role on the server;
 * hiding a link is never the protection.
 */
export async function requirePlatformAdmin() {
  const session = await getSession();
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? '';
  if (!session || !role.split(',').includes('admin')) throw new Error('FORBIDDEN');
  return session.user;
}
