'use client';

import { Fingerprint } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Link, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { errorKey } from '@/lib/auth-errors';

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations('Auth.signIn');
  const te = useTranslations('Errors');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function done() {
    router.replace(next);
    router.refresh();
  }

  // Passkey autofill: offered in the browser's own credential picker when supported.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await window.PublicKeyCredential?.isConditionalMediationAvailable?.();
      if (!available || cancelled) return;
      const res = await authClient.signIn.passkey({ autoFill: true }).catch(() => null);
      if (!cancelled && res && !res.error) done();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email: email.trim(), password });
    if (error) {
      setError(te(errorKey(error)));
      setPending(false);
      return;
    }
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      router.push(`/two-factor?next=${encodeURIComponent(next)}`);
      return;
    }
    done();
  }

  async function onPasskey() {
    setPending(true);
    setError(null);
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setError(te(errorKey(res.error)));
      setPending(false);
      return;
    }
    done();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label={t('email')}
        type="email"
        name="email"
        autoComplete="username webauthn"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label={t('password')}
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        labelAction={
          <Link
            href="/forgot-password"
            className="text-sm text-muted underline underline-offset-4 hover:text-ink"
          >
            {t('forgot')}
          </Link>
        }
      />
      <Button type="submit" loading={pending} className="w-full">
        {t('submit')}
      </Button>
      <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        {t('or')}
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={onPasskey}
        disabled={pending}
        className="w-full"
      >
        <Fingerprint className="size-4" aria-hidden="true" />
        {t('passkey')}
      </Button>
      <p className="pt-2 text-sm text-muted">{t('inviteOnly')}</p>
    </form>
  );
}
