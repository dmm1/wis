'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Link } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';

export function ForgotPasswordForm() {
  const t = useTranslations('Auth.forgot');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    // Always show the same confirmation: never reveal whether an account exists.
    await authClient
      .requestPasswordReset({ email: email.trim(), redirectTo: `/${locale}/reset-password` })
      .catch(() => null);
    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <div className="space-y-5">
        <Alert tone="success">{t('sent')}</Alert>
        <Link
          href="/sign-in"
          className="text-sm text-muted underline underline-offset-4 hover:text-ink"
        >
          {t('back')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field
        label={t('email')}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" loading={pending} className="w-full">
        {t('submit')}
      </Button>
      <Link
        href="/sign-in"
        className="block text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        {t('back')}
      </Link>
    </form>
  );
}
