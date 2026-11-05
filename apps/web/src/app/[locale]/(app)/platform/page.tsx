import { Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listTenants } from '@wis/auth';
import { SeatBlocks } from '@/components/shell/seat-blocks';
import { Link } from '@/i18n/navigation';
import { getAuthContext } from '@/lib/auth';
import { StatusPill } from './status-pill';

const STATUSES = ['trial', 'active', 'suspended', 'offboarding'] as const;

export default async function PlatformPage({
  params,
  searchParams,
}: PageProps<'/[locale]/platform'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const search = typeof sp.q === 'string' ? sp.q : '';
  const status = STATUSES.find((s) => s === sp.status);
  const t = await getTranslations('Platform');
  const tm = await getTranslations('Home.modules');
  const { items, total } = await listTenants(getAuthContext().db, {
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
          <p className="mt-2 text-muted">{t('subtitle')}</p>
        </div>
        <Link
          href="/platform/new"
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-4 font-medium text-on-ink hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('newTenant')}
        </Link>
      </div>

      <form method="get" role="search" className="mt-7 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="q">
          {t('searchLabel')}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={search}
          placeholder={t('searchPlaceholder')}
          className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 sm:max-w-xs"
        />
        <label className="sr-only" htmlFor="status">
          {t('statusLabel')}
        </label>
        <select
          id="status"
          name="status"
          defaultValue={status ?? ''}
          className="h-11 rounded-lg border border-line bg-surface px-3 sm:w-48"
        >
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-11 rounded-lg border border-line bg-surface px-4 font-medium hover:bg-paper"
        >
          {t('filter')}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted" role="status">
        {t('count', { count: total })}
      </p>

      {items.length === 0 ? (
        <section className="mt-3 max-w-lg rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">
            {search || status ? t('noMatchTitle') : t('emptyTitle')}
          </h2>
          <p className="mt-2 text-muted">{search || status ? t('noMatchBody') : t('emptyBody')}</p>
        </section>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((tn) => (
            <li key={tn.id}>
              <Link
                href={`/platform/${tn.id}`}
                className="grid gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-muted/60 md:grid-cols-[minmax(0,1.4fr)_7.5rem_minmax(0,1fr)] md:items-center md:p-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{tn.name}</p>
                  <p className="truncate text-sm text-muted">{tn.slug}</p>
                </div>
                <div className="justify-self-start">
                  <StatusPill status={tn.status} />
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-sm tabular-nums text-muted">
                    {t('seats', {
                      used: tn.seatsUsed,
                      reserved: tn.seatsReserved,
                      max: tn.maxSeats,
                    })}
                  </p>
                  <SeatBlocks used={tn.seatsUsed} reserved={tn.seatsReserved} max={tn.maxSeats} />
                  {tn.modules.length > 0 ? (
                    <p className="mt-2 truncate text-sm text-muted">
                      {tn.modules.map((m) => (tm.has(m as never) ? tm(m as never) : m)).join(', ')}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
