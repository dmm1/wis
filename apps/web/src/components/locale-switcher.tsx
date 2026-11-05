'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { authClient } from '@/lib/auth-client';

/** Two-option language switch. When signed in, the choice is also saved on the account (used for e-mails). */
export function LocaleSwitcher({
  persist = false,
  className,
}: {
  persist?: boolean;
  className?: string;
}) {
  const t = useTranslations('Shell');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function choose(next: (typeof routing.locales)[number]) {
    if (next === locale) return;
    if (persist) void authClient.updateUser({ locale: next } as never);
    const search = window.location.search; // keep tokens etc. when switching language
    router.replace(`${pathname}${search}`, { locale: next });
  }

  return (
    <div
      role="group"
      aria-label={t('language')}
      className={cn('inline-flex rounded-lg border border-line bg-surface p-0.5', className)}
    >
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          aria-pressed={l === locale}
          lang={l}
          className={cn(
            'h-8 min-w-10 rounded-md px-2.5 text-sm font-medium transition-colors',
            l === locale ? 'bg-ink text-on-ink' : 'text-muted hover:text-ink',
          )}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
