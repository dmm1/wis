import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatBlocks } from '@/components/shell/seat-blocks';
import { TenantGate } from '@/components/shell/tenant-gate';
import { redirect } from '@/i18n/navigation';
import { getAppContext } from '@/lib/session';

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  const c = ctx!;
  const t = await getTranslations('Home');
  const tr = await getTranslations('Roles');

  const roleKey = (c.memberRole ?? '').split(',')[0]?.trim() ?? '';
  const roleLabel = roleKey ? (tr.has(roleKey) ? tr(roleKey) : roleKey) : null;
  const canSeeSeats = (c.memberRole ?? '').split(',').includes('customer-admin');
  const firstName = c.user.name.split(/\s+/)[0] ?? c.user.name;

  return (
    <TenantGate ctx={c}>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('greeting', { name: firstName })}</h1>
      {roleLabel && c.tenant ? (
        <p className="mt-2 text-muted">
          {t('context', { role: roleLabel, workspace: c.tenant.name })}
        </p>
      ) : null}

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section
          aria-labelledby="modules-title"
          className="rounded-xl border border-line bg-surface p-5"
        >
          <h2 id="modules-title" className="text-lg font-semibold">
            {t('modulesTitle')}
          </h2>
          {c.tenant && c.tenant.modules.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {c.tenant.modules.map((m) => (
                <li
                  key={m}
                  className="flex h-10 items-center rounded-lg bg-paper px-3 text-[0.9375rem]"
                >
                  {t.has(`modules.${m}` as never) ? t(`modules.${m}` as never) : m}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">{t('modulesEmpty')}</p>
          )}
        </section>

        {canSeeSeats && c.tenant ? (
          <section
            aria-labelledby="seats-title"
            className="rounded-xl border border-line bg-surface p-5"
          >
            <h2 id="seats-title" className="text-lg font-semibold">
              {t('seatsTitle')}
            </h2>
            <p className="mb-4 mt-2 tabular-nums text-muted">
              {t('seatsSummary', { used: c.tenant.seatsUsed, max: c.tenant.maxSeats })}
              {c.tenant.seatsReserved > 0
                ? ` ${t('seatsReserved', { reserved: c.tenant.seatsReserved })}`
                : ''}
            </p>
            <SeatBlocks
              used={c.tenant.seatsUsed}
              reserved={c.tenant.seatsReserved}
              max={c.tenant.maxSeats}
            />
          </section>
        ) : null}
      </div>
    </TenantGate>
  );
}
