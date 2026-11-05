'use server';

import { z } from 'zod';
import { createInvitedUser, InvitationError } from '@wis/auth';
import { getAuthContext } from '@/lib/auth';

const input = z.object({
  invitationId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
  locale: z.enum(['en', 'de']),
});

export type CreateAccountResult = { ok: true } | { ok: false; code: string };

/**
 * Creates the account for an invited person. The secret invitation id (delivered by e-mail)
 * is the proof of control over the invited address; open sign-up stays closed.
 */
export async function createAccountFromInvitation(raw: unknown): Promise<CreateAccountResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    const tooShort = parsed.error.issues.some((i) => i.path[0] === 'password');
    return { ok: false, code: tooShort ? 'PASSWORD_TOO_SHORT' : 'INVITATION_INVALID' };
  }
  const { auth, db } = getAuthContext();
  try {
    await createInvitedUser({ auth, db }, parsed.data);
    return { ok: true };
  } catch (e) {
    if (e instanceof InvitationError) return { ok: false, code: e.code };
    throw e;
  }
}
