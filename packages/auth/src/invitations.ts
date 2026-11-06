import { and, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema } from '@wis/db';
import { writeAudit } from '@wis/db';
import type { Auth } from './auth';

type Db = NodePgDatabase<typeof schema>;

export type InvitationPreview =
  | { state: 'not_found' }
  | { state: 'expired'; organizationName: string }
  | { state: 'used'; organizationName: string }
  | {
      state: 'pending';
      organizationName: string;
      email: string;
      role: string | null;
      /** True when an account for this e-mail already exists (sign in instead of sign up). */
      accountExists: boolean;
    };

/**
 * Public preview of an invitation for the accept page. The invitation id is an unguessable
 * secret delivered by e-mail; it is the proof that the visitor controls the invited address.
 */
export async function getInvitationPreview(
  db: Db,
  invitationId: string,
): Promise<InvitationPreview> {
  const [row] = await db
    .select({
      email: schema.invitation.email,
      role: schema.invitation.role,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      organizationName: schema.organization.name,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .where(eq(schema.invitation.id, invitationId));
  if (!row) return { state: 'not_found' };
  if (row.status !== 'pending') return { state: 'used', organizationName: row.organizationName };
  if (row.expiresAt <= new Date())
    return { state: 'expired', organizationName: row.organizationName };

  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, row.email.toLowerCase()));
  return {
    state: 'pending',
    organizationName: row.organizationName,
    email: row.email,
    role: row.role,
    accountExists: Boolean(existing),
  };
}

export class InvitationError extends Error {
  constructor(readonly code: 'INVITATION_INVALID' | 'ACCOUNT_EXISTS') {
    super(code);
    this.name = 'InvitationError';
  }
}

/**
 * Creates the account for an invited person. Open sign-up is disabled in production
 * (`restrictSignUp`), so this is the only way a new customer account comes to exist: the caller
 * must present the secret invitation id. The e-mail is marked verified because the invitation
 * link was delivered to that address. Password policy is enforced here too.
 */
export async function createInvitedUser(
  deps: { auth: Auth; db: Db },
  p: { invitationId: string; name: string; password: string; locale: 'en' | 'de' },
): Promise<{ userId: string }> {
  const preview = await getInvitationPreview(deps.db, p.invitationId);
  if (preview.state !== 'pending') throw new InvitationError('INVITATION_INVALID');
  if (preview.accountExists) throw new InvitationError('ACCOUNT_EXISTS');

  const ctx = await deps.auth.$context;
  const min = ctx.password.config.minPasswordLength;
  if (p.password.length < min || p.password.length > ctx.password.config.maxPasswordLength) {
    throw new InvitationError('INVITATION_INVALID');
  }
  const email = preview.email.toLowerCase();
  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name: p.name.trim().slice(0, 120) || email,
      emailVerified: true,
      locale: p.locale,
    },
    { method: 'invitation' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(p.password),
  });
  await writeAudit(deps.db, {
    tenantId: null,
    actorType: 'system',
    action: 'user.created_from_invitation',
    targetType: 'user',
    targetId: user.id,
    metadata: { invitationId: p.invitationId },
  });
  return { userId: user.id };
}

/** Pending, unexpired invitations for an e-mail, with the workspace name (shown when someone has no workspace yet). */
export async function pendingInvitationsFor(db: Db, email: string) {
  return db
    .select({
      id: schema.invitation.id,
      organizationId: schema.invitation.organizationId,
      organizationName: schema.organization.name,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .where(
      and(
        eq(schema.invitation.email, email.toLowerCase()),
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    );
}
