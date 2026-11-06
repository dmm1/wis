import { Link2, Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { withTenant } from '@wis/db';
import { listEmployees } from '@wis/people';
import { TenantGate } from '@/components/shell/tenant-gate';
import { Link, redirect } from '@/i18n/navigation';
import { getRequestActor } from '@/lib/actor';
import { getAuthContext } from '@/lib/auth';
import { getAppContext } from '@/lib/session';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive', 'all'] as const;

export default async function EmployeesPage({
  params,
  searchParams,
}: PageProps<'/[locale]/employees'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  return (
    <TenantGate ctx={ctx!}>
      <Content searchParams={await searchParams} />
    </TenantGate>
  );
}

async function Content({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ra = await getRequestActor();
  if (!ra || !ra.actor.can('employee', 'read')) notFound();
  const { actor, tenantId } = ra!;
  const t = await getTranslations('Employees');
  const q = typeof searchParams.q === 'string' ? searchParams.q : '';
  const status = STATUSES.find((s) => s === searchParams.status) ?? 'active';
  const page = Math.max(1, Number(searchParams.page) || 1);

  const { items, total } = await withTenant(getAuthContext().appDb, tenantId, (tx) =>
    listEmployees(tx, actor, {
      search: q,
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) =>
    `/employees?${new URLSearchParams({ ...(q ? { q } : {}), status, page: String(p) })}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
          <p className="mt-2 text-muted">{t('subtitle')}</p>
        </div>
        {actor.can('employee', 'create') ? (
          <Link
            href="/employees/new"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-4 font-medium text-on-ink hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('add')}
          </Link>
        ) : null}
      </div>

      <form method="get" role="search" className="mt-7 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="q">
          {t('searchLabel')}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t('searchPlaceholder')}
          className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 sm:max-w-sm"
        />
        <label className="sr-only" htmlFor="status">
          {t('statusLabel')}
        </label>
        <select
          id="status"
          name="status"
          defaultValue={status}
          className="h-11 rounded-lg border border-line bg-surface px-3 sm:w-44"
        >
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
            {q || status !== 'active' ? t('noMatchTitle') : t('emptyTitle')}
          </h2>
          <p className="mt-2 text-muted">
            {q || status !== 'active' ? t('noMatchBody') : t('emptyBody')}
          </p>
        </section>
      ) : (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((e) => (
            <li key={e.id}>
              <Link
                href={`/employees/${e.id}`}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3.5 hover:bg-paper md:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {e.lastName}, {e.firstName}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {[
                      e.personnelNumber
                        ? t('personnelNumber', { number: e.personnelNumber })
                        : null,
                      e.email,
                    ]
                      .filter(Boolean)
                      .join(' · ') || ' '}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted">
                  {e.hasLogin ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Link2 className="size-3.5" aria-hidden="true" />
                      {t('hasLogin')}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'inline-flex h-7 items-center gap-2 rounded-full border border-line px-3',
                      !e.active && 'text-muted',
                    )}
                  >
                    <span
                      className={cn('size-2 rounded-full', e.active ? 'bg-success' : 'bg-muted')}
                      aria-hidden="true"
                    />
                    {e.active ? t('status.active') : t('status.inactive')}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav
          aria-label={t('pagination')}
          className="mt-5 flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link
              href={href(page - 1)}
              className="rounded-lg border border-line bg-surface px-4 py-2.5 hover:bg-paper"
            >
              {t('previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-muted">{t('page', { page, pages })}</span>
          {page < pages ? (
            <Link
              href={href(page + 1)}
              className="rounded-lg border border-line bg-surface px-4 py-2.5 hover:bg-paper"
            >
              {t('next')}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
