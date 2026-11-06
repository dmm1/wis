'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { linkLoginAction } from './actions';

interface Account {
  userId: string;
  name: string;
  email: string;
}

const KNOWN = [
  'FORBIDDEN',
  'NOT_A_MEMBER',
  'ALREADY_LINKED',
  'EMPLOYEE_NOT_FOUND',
  'SEAT_LIMIT_REACHED',
  'VALIDATION',
];

export function LoginPanel({
  employeeId,
  linked,
  available,
}: {
  employeeId: string;
  linked: Account | null;
  available: Account[];
}) {
  const t = useTranslations('Employees.login');
  const te = useTranslations('Employees.errors');
  const router = useRouter();
  const [choice, setChoice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(userId: string | null) {
    setPending(true);
    setError(null);
    const res = await linkLoginAction({ employeeId, userId });
    setPending(false);
    if (!res.ok) return setError(te((KNOWN.includes(res.code) ? res.code : 'generic') as never));
    setChoice('');
    router.refresh();
  }

  return (
    <section
      aria-labelledby="login-title"
      className="max-w-2xl rounded-xl border border-line bg-surface p-5 md:p-6"
    >
      <h2 id="login-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="mb-4 mt-1 max-w-prose text-muted">{t('description')}</p>
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>{t('linked', { name: linked.name, email: linked.email })}</p>
          <Button variant="secondary" loading={pending} onClick={() => apply(null)}>
            {t('unlink')}
          </Button>
        </div>
      ) : available.length === 0 ? (
        <p className="text-muted">{t('noneAvailable')}</p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label htmlFor="login-select" className="text-sm font-medium">
              {t('choose')}
            </label>
            <select
              id="login-select"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-surface px-3"
            >
              <option value="">{t('none')}</option>
              {available.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name} ({a.email})
                </option>
              ))}
            </select>
          </div>
          <Button loading={pending} disabled={!choice} onClick={() => apply(choice)}>
            {t('link')}
          </Button>
        </div>
      )}
    </section>
  );
}
