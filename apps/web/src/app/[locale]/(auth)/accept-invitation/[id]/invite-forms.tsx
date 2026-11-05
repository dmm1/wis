'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { errorKey } from '@/lib/auth-errors';
import { createAccountFromInvitation } from './actions';

/** Accepts the invitation for the signed-in user, makes the workspace active, and enters the app. */
async function acceptAndEnter(invitationId: string) {
  const res = await authClient.organization.acceptInvitation({ invitationId });
  if (res.error) return res.error;
  const organizationId = (res.data as { invitation?: { organizationId?: string } } | null)
    ?.invitation?.organizationId;
  if (organizationId) await authClient.organization.setActive({ organizationId });
  return null;
}

export function InviteAccept({ invitationId }: { invitationId: string }) {
  const t = useTranslations('Auth.invite');
  const te = useTranslations('Errors');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    const err = await acceptAndEnter(invitationId);
    if (err) {
      setError(te(errorKey(err)));
      setPending(false);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button onClick={accept} loading={pending} className="w-full">
        {t('accept')}
      </Button>
    </div>
  );
}

export function InviteSignUp({ invitationId, email }: { invitationId: string; email: string }) {
  const t = useTranslations('Auth.invite');
  const te = useTranslations('Errors');
  const locale = useLocale() as 'en' | 'de';
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const created = await createAccountFromInvitation({ invitationId, name, password, locale });
    if (!created.ok) {
      setError(te(errorKey({ code: created.code })));
      setPending(false);
      return;
    }
    const signedIn = await authClient.signIn.email({ email, password });
    if (signedIn.error) {
      setError(te(errorKey(signedIn.error)));
      setPending(false);
      return;
    }
    const err = await acceptAndEnter(invitationId);
    if (err) {
      setError(te(errorKey(err)));
      setPending(false);
      return;
    }
    router.replace('/settings/security?welcome=1');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label={t('email')}
        type="email"
        value={email}
        readOnly
        disabled
        autoComplete="username"
      />
      <Field
        label={t('name')}
        name="name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label={t('password')}
        hint={t('passwordHint')}
        type="password"
        name="new-password"
        autoComplete="new-password"
        minLength={12}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" loading={pending} className="w-full">
        {t('createAndJoin')}
      </Button>
    </form>
  );
}

export function InviteSignIn({ invitationId, email }: { invitationId: string; email: string }) {
  const t = useTranslations('Auth.invite');
  const te = useTranslations('Errors');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError(te(errorKey(error)));
      setPending(false);
      return;
    }
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      router.push(`/two-factor?next=${encodeURIComponent(`/accept-invitation/${invitationId}`)}`);
      return;
    }
    router.refresh(); // page re-renders as the signed-in "accept" state
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <p className="text-sm text-muted">{t('haveAccount')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label={t('email')}
        type="email"
        value={email}
        readOnly
        disabled
        autoComplete="username"
      />
      <Field
        label={t('password')}
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" loading={pending} className="w-full">
        {t('signInToJoin')}
      </Button>
    </form>
  );
}

export function WrongAccount({
  invitedEmail,
  currentEmail,
}: {
  invitedEmail: string;
  currentEmail: string;
}) {
  const t = useTranslations('Auth.invite');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Alert tone="info">
        {t('wrongAccount', { invited: invitedEmail, current: currentEmail })}
      </Alert>
      <Button variant="secondary" onClick={signOut} loading={pending} className="w-full">
        {t('signOutAndContinue')}
      </Button>
    </div>
  );
}
