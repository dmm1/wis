'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Link, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { errorKey } from '@/lib/auth-errors';

export function TwoFactorForm({ next }: { next: string }) {
  const t = useTranslations('Auth.twoFactor');
  const te = useTranslations('Errors');
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const clean = code.replace(/\s+/g, '');
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: clean, trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code: clean, trustDevice: trust });
    if (res.error) {
      setError(te(errorKey(res.error)));
      setPending(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-5" noValidate>
      <p className="text-muted">{useBackup ? t('backupSubtitle') : t('subtitle')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        key={useBackup ? 'backup' : 'totp'}
        label={useBackup ? t('backupLabel') : t('codeLabel')}
        name="code"
        autoComplete="one-time-code"
        inputMode={useBackup ? 'text' : 'numeric'}
        autoFocus
        required
        className="tracking-widest tabular-nums"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
          className="size-4 accent-[var(--ink)]"
        />
        {t('trust')}
      </label>
      <Button type="submit" loading={pending} className="w-full">
        {t('submit')}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode('');
            setError(null);
          }}
          className="text-muted underline underline-offset-4 hover:text-ink"
        >
          {useBackup ? t('useApp') : t('useBackup')}
        </button>
        <Link href="/sign-in" className="text-muted underline underline-offset-4 hover:text-ink">
          {t('back')}
        </Link>
      </div>
    </form>
  );
}
