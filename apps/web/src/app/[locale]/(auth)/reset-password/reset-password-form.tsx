'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Link } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { errorKey } from '@/lib/auth-errors';

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('Auth.reset');
  const te = useTranslations('Errors');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setError(te(errorKey(error)));
      setPending(false);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Alert tone="success">{t('done')}</Alert>
        <Link
          href="/sign-in"
          className="inline-flex h-11 items-center rounded-lg bg-ink px-4 font-medium text-on-ink"
        >
          {t('toSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label={t('password')}
        hint={t('hint')}
        type="password"
        name="new-password"
        autoComplete="new-password"
        minLength={12}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" loading={pending} className="w-full">
        {t('submit')}
      </Button>
    </form>
  );
}
