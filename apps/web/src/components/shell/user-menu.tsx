'use client';

import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronsUpDown, Languages, LogOut, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/cn';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', de: 'Deutsch' };

export function UserMenu({
  name,
  email,
  variant,
}: {
  name: string;
  email: string;
  variant: 'rail' | 'compact';
}) {
  const t = useTranslations('Shell');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  async function signOut() {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  }

  function setLocale(next: (typeof routing.locales)[number]) {
    if (next === locale) return;
    void authClient.updateUser({ locale: next } as never);
    router.replace(pathname, { locale: next });
  }

  const avatar = (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-night text-[0.8125rem] font-semibold text-white">
      {initials(name)}
    </span>
  );

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        aria-label={t('accountMenu')}
        className={cn(
          'flex items-center gap-2.5 rounded-lg transition-colors hover:bg-ink/5 data-[state=open]:bg-ink/5',
          variant === 'rail' ? 'w-full px-2.5 py-2 text-left' : 'p-1',
        )}
      >
        {avatar}
        {variant === 'rail' ? (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs text-muted">{email}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
          </>
        ) : null}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={variant === 'rail' ? 'start' : 'end'}
          side={variant === 'rail' ? 'top' : 'bottom'}
          sideOffset={6}
          className="z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-sm text-muted">{email}</p>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item
            onSelect={() => router.push('/settings/security')}
            className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[0.9375rem] outline-none data-[highlighted]:bg-ink/5"
          >
            <ShieldCheck className="size-4 text-muted" aria-hidden="true" />
            {t('nav.security')}
          </Dropdown.Item>
          <Dropdown.Label className="mt-1 flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-muted">
            <Languages className="size-4" aria-hidden="true" />
            {t('language')}
          </Dropdown.Label>
          {routing.locales.map((l) => (
            <Dropdown.Item
              key={l}
              lang={l}
              onSelect={() => setLocale(l)}
              className="flex h-10 cursor-pointer items-center justify-between rounded-lg pl-9 pr-2.5 text-[0.9375rem] outline-none data-[highlighted]:bg-ink/5"
            >
              {LANGUAGE_NAMES[l]}
              {l === locale ? <Check className="size-4 text-day" aria-hidden="true" /> : null}
            </Dropdown.Item>
          ))}
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item
            onSelect={signOut}
            className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[0.9375rem] outline-none data-[highlighted]:bg-ink/5"
          >
            <LogOut className="size-4 text-muted" aria-hidden="true" />
            {t('signOut')}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
