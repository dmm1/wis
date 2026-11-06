import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema } from '@wis/db';
import { writeAudit } from '@wis/db';
import { TenantError } from './errors';
import { assertNotLastAdmin, assertSeatAvailable } from './guards';
import { consoleMailer, type Mailer } from './mailer';
import { ac, CREATOR_ROLE, tenantRoles } from './permissions';
import { invitationEmail, resetPasswordEmail, toMailLocale, verifyEmail } from './templates';

type Db = NodePgDatabase<typeof schema>;

export interface AuthOptions {
  /** Drizzle instance created with the full schema (owner connection; auth tables are not tenant-scoped). */
  db: Db;
  secret: string;
  baseURL: string;
  /** WebAuthn relying-party id (host without port), e.g. "localhost" or "app.wis.example". */
  rpID: string;
  production?: boolean;
  /**
   * Disable open e-mail sign-up: accounts can then only be created from a valid invitation
   * (`createInvitedUser`) or by a platform admin. Enable in every real deployment.
   */
  restrictSignUp?: boolean;
  mailer?: Mailer;
  trustedOrigins?: string[];
}

/** Turns a domain error into a client-visible API error with a stable code. */
function asApiError(e: unknown): never {
  if (e instanceof TenantError) {
    throw new APIError('FORBIDDEN', { message: e.code, code: e.code });
  }
  throw e;
}

function orgLocale(metadata: unknown, fallback: unknown) {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (m && typeof m === 'object' && 'locale' in m)
      return toMailLocale((m as { locale?: unknown }).locale);
  } catch {
    /* ignore malformed metadata */
  }
  return toMailLocale(fallback);
}

const ADMIN_AUDITED: Record<string, string> = {
  '/admin/set-role': 'platform.user_role_set',
  '/admin/ban-user': 'platform.user_banned',
  '/admin/unban-user': 'platform.user_unbanned',
  '/admin/impersonate-user': 'platform.user_impersonated',
  '/admin/remove-user': 'platform.user_removed',
  '/admin/create-user': 'platform.user_created',
};

export function createAuth(options: AuthOptions) {
  const production = options.production ?? false;
  if (production && !options.mailer) {
    // The console mailer prints verification/reset/invitation links to the logs.
    throw new Error('A real Mailer is required when production is true');
  }
  const mailer = options.mailer ?? consoleMailer;
  const { db } = options;

  return betterAuth({
    appName: 'WIS',
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins ?? [options.baseURL],
    database: drizzleAdapter(options.db, { provider: 'pg', usePlural: false }),

    emailAndPassword: {
      enabled: true,
      disableSignUp: options.restrictSignUp ?? false,
      minPasswordLength: 12,
      requireEmailVerification: production,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send(
          resetPasswordEmail(toMailLocale((user as { locale?: unknown }).locale), {
            to: user.email,
            url,
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: production,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send(
          verifyEmail(toMailLocale((user as { locale?: unknown }).locale), { to: user.email, url }),
        );
      },
    },

    user: {
      additionalFields: {
        // UI + e-mail language. Constrained to en|de by a DB check constraint.
        locale: { type: 'string', required: false, defaultValue: 'en', input: true },
        // Remembered so people with several workspaces land in the one they used last. Server-managed.
        lastWorkspaceId: { type: 'string', required: false, input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    advanced: { useSecureCookies: production },
    rateLimit: { enabled: true, storage: 'database' },

    databaseHooks: {
      session: {
        create: {
          // A workspace is active from the first request of every session when the choice is obvious:
          // the only one, or (with several) the one used last, if the person still belongs to it.
          before: async (session) => {
            const memberships = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId));
            let chosen: string | undefined;
            if (memberships.length === 1) chosen = memberships[0]!.organizationId;
            else if (memberships.length > 1) {
              const [u] = await db
                .select({ last: schema.user.lastWorkspaceId })
                .from(schema.user)
                .where(eq(schema.user.id, session.userId));
              chosen = memberships.find((m) => m.organizationId === u?.last)?.organizationId;
            }
            if (chosen) return { data: { ...session, activeOrganizationId: chosen } };
          },
        },
      },
    },

    hooks: {
      // Audit trail for tenant administration and platform actions (only successful calls).
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.context.returned instanceof Error) return;
        const path = ctx.path;
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx).catch(() => null));
        const actorId = session?.user.id ?? null;
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === 'string' ? v : null);

        if (ADMIN_AUDITED[path]) {
          await writeAudit(db, {
            tenantId: null,
            actorType: 'platform',
            actorId,
            action: ADMIN_AUDITED[path],
            targetType: 'user',
            targetId: str(body.userId),
            metadata: body.role ? { role: body.role } : {},
          });
          return;
        }

        if (path === '/organization/set-active' && actorId && str(body.organizationId)) {
          await db
            .update(schema.user)
            .set({ lastWorkspaceId: str(body.organizationId) })
            .where(eq(schema.user.id, actorId));
          return;
        }

        const orgId = str(body.organizationId) ?? session?.session.activeOrganizationId ?? null;
        const map: Record<
          string,
          { action: string; target: unknown; meta?: Record<string, unknown> }
        > = {
          '/organization/invite-member': {
            action: 'invitation.created',
            target: body.email,
            meta: { role: body.role },
          },
          '/organization/remove-member': { action: 'member.removed', target: body.memberIdOrEmail },
          '/organization/update-member-role': {
            action: 'member.role_changed',
            target: body.memberId,
            meta: { role: body.role },
          },
        };
        const hit = map[path];
        if (hit && orgId) {
          await writeAudit(db, {
            tenantId: orgId,
            actorType: 'user',
            actorId,
            action: hit.action,
            targetType: 'member',
            targetId: str(hit.target),
            metadata: hit.meta ?? {},
          });
        } else if (path === '/organization/accept-invitation' && actorId) {
          const returned = ctx.context.returned as
            { invitation?: { organizationId?: string; id?: string } } | undefined;
          await writeAudit(db, {
            tenantId: returned?.invitation?.organizationId ?? null,
            actorType: 'user',
            actorId,
            action: 'invitation.accepted',
            targetType: 'invitation',
            targetId: returned?.invitation?.id ?? str(body.invitationId),
          });
        }
      }),
    },

    plugins: [
      // Platform operators (global admin): provisioning tenants, support, bans.
      admin(),
      // Tenants. Customers cannot create or delete tenants; the platform does.
      organization({
        ac,
        roles: tenantRoles,
        creatorRole: CREATOR_ROLE,
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        teams: { enabled: true },
        dynamicAccessControl: { enabled: true },
        organizationHooks: {
          beforeCreateInvitation: async ({ organization }) => {
            try {
              await assertSeatAvailable(db, organization.id);
            } catch (e) {
              asApiError(e);
            }
          },
          beforeRemoveMember: async ({ member, organization }) => {
            try {
              await assertNotLastAdmin(db, {
                tenantId: organization.id,
                memberId: member.id,
                currentRoles: member.role,
              });
            } catch (e) {
              asApiError(e);
            }
          },
          beforeUpdateMemberRole: async ({ member, newRole, organization }) => {
            try {
              await assertNotLastAdmin(db, {
                tenantId: organization.id,
                memberId: member.id,
                currentRoles: member.role,
                newRoles: Array.isArray(newRole) ? newRole.join(',') : String(newRole),
              });
            } catch (e) {
              asApiError(e);
            }
          },
        },
        sendInvitationEmail: async ({ email, organization, id, inviter }) => {
          await mailer.send(
            invitationEmail(
              orgLocale(organization.metadata, (inviter.user as { locale?: unknown }).locale),
              {
                to: email,
                inviterName: inviter.user.name,
                organizationName: organization.name,
                url: `${options.baseURL}/accept-invitation/${id}`,
              },
            ),
          );
        },
      }),
      twoFactor({ issuer: 'WIS' }),
      passkey({ rpID: options.rpID, rpName: 'WIS', origin: options.baseURL }),
      nextCookies(), // keep last
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
