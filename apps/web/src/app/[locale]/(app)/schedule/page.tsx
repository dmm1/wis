import { CalendarDays } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isModuleEnabled } from '@wis/auth';
import { TenantGate } from '@/components/shell/tenant-gate';
import { redirect } from '@/i18n/navigation';
import { getAppContext } from '@/lib/session';

export default async function SchedulePage({ params }: PageProps<'/[locale]/schedule'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  const c = ctx!;
  // Entitlement gate: a module the workspace doesn't have is indistinguishable from a missing page.
  if (c.tenant && !isModuleEnabled(c.tenant, 'work-schedule')) notFound();
  const t = await getTranslations('work-schedule');

  return (
    <TenantGate ctx={c}>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('nav.title')}</h1>
      <section className="mt-8 max-w-lg rounded-xl border border-line bg-surface p-6">
        <CalendarDays className="mb-3 size-5 text-muted" aria-hidden="true" />
        <h2 className="text-lg font-semibold">{t('empty.title')}</h2>
        <p className="mt-2 text-muted">{t('empty.body')}</p>
      </section>
    </TenantGate>
  );
}
