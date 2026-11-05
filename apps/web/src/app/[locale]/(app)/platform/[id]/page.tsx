import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { canTransition, getTenantDetail, registry } from '@wis/auth';
import { Alert } from '@/components/ui/alert';
import { SeatBlocks } from '@/components/shell/seat-blocks';
import { Link } from '@/i18n/navigation';
import { getAuthContext } from '@/lib/auth';
import { StatusPill } from '../status-pill';
import { ModulesForm, ResendButton, SeatsForm, StatusControls } from './tenant-controls';

const ALL = ['trial', 'active', 'suspended', 'offboarding'] as const;

export default async function TenantDetailPage({
  params,
  searchParams,
}: PageProps<'/[locale]/platform/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const detail = await getTenantDetail(getAuthContext().db, id);
  if (!detail) notFound();
  const d = detail!;

  const t = await getTranslations('Platform.detail');
  const tAudit = await getTranslations('Platform.audit');
  const tStatus = await getTranslations('Platform.status');
  const tRoles = await getTranslations('Roles');
  const tm = await getTranslations('Home.modules');
  const format = await getFormatter();

  const moduleLabel = (m: string) => (tm.has(m as never) ? tm(m as never) : m);
  const available = registry.ids().map((mid) => ({ id: mid, label: moduleLabel(mid) }));
  const allowed = ALL.filter((s) => canTransition(d.status, s));
  const roleLabel = (r: string | null) => {
    const k = (r ?? '').split(',')[0]?.trim() ?? '';
    return k && tRoles.has(k as never) ? tRoles(k as never) : k;
  };
  const when = (date: Date) => format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' });

  const describe = (a: (typeof d.activity)[number]) => {
    const m = (a.metadata ?? {}) as Record<string, unknown>;
    const key = a.action.replace(/[.]/g, '_');
    const list = (v: unknown) =>
      Array.isArray(v) && v.length ? v.map((x) => moduleLabel(String(x))).join(', ') : '–';
    if (!tAudit.has(key as never)) return a.action;
    return tAudit(
      key as never,
      {
        from: m.from
          ? tStatus.has(String(m.from) as never)
            ? tStatus(String(m.from) as never)
            : String(m.from)
          : '',
        to: m.to
          ? tStatus.has(String(m.to) as never)
            ? tStatus(String(m.to) as never)
            : String(m.to)
          : '',
        fromSeats: String(m.from ?? ''),
        toSeats: String(m.to ?? ''),
        added: list(m.added),
        removed: list(m.removed),
      } as never,
    );
  };

  return (
    <>
      <Link
        href="/platform"
        className="text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        {t('back')}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[1.75rem] font-bold sm:text-3xl">{d.name}</h1>
        <StatusPill status={d.status} />
      </div>
      <p className="mt-1 text-muted">
        {d.slug} · {t('created', { date: when(d.createdAt) })}
      </p>
      {sp.mail === 'failed' ? (
        <Alert tone="error" className="mt-6">
          {t('mailFailed')}
        </Alert>
      ) : null}

      <div className="mt-8 grid gap-5">
        <Section id="status" title={t('statusTitle')}>
          <StatusControls tenantId={d.id} allowed={allowed} />
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section id="seats" title={t('seats.title')}>
            <p className="mb-4 tabular-nums text-muted">
              {t('seats.summary', {
                used: d.seatsUsed,
                reserved: d.seatsReserved,
                max: d.maxSeats,
              })}
            </p>
            <div className="mb-5">
              <SeatBlocks used={d.seatsUsed} reserved={d.seatsReserved} max={d.maxSeats} />
            </div>
            <SeatsForm
              tenantId={d.id}
              maxSeats={d.maxSeats}
              inUse={d.seatsUsed + d.seatsReserved}
            />
          </Section>
          <Section id="modules" title={t('modules.title')}>
            <ModulesForm tenantId={d.id} available={available} enabled={d.modules} />
          </Section>
        </div>

        <Section id="people" title={t('people.title')}>
          {d.members.length === 0 && d.invitations.length === 0 ? (
            <p className="text-muted">{t('people.empty')}</p>
          ) : null}
          {d.members.length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {d.members.map((m) => (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.name}</p>
                    <p className="truncate text-sm text-muted">{m.email}</p>
                  </div>
                  <span className="text-sm text-muted">{roleLabel(m.role)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {d.invitations.length > 0 ? (
            <>
              <h3 className="mb-2 mt-6 font-semibold">{t('people.pending')}</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {d.invitations.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.email}</p>
                      <p className="text-sm text-muted">
                        {roleLabel(i.role)} ·{' '}
                        {i.expired
                          ? t('people.expired')
                          : t('people.expires', { date: when(i.expiresAt) })}
                      </p>
                    </div>
                    <ResendButton invitationId={i.id} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Section>

        <Section id="activity" title={t('activity.title')}>
          {d.activity.length === 0 ? (
            <p className="text-muted">{t('activity.empty')}</p>
          ) : (
            <ol className="space-y-3">
              {d.activity.map((a) => (
                <li key={a.id} className="grid gap-x-4 sm:grid-cols-[11rem_1fr]">
                  <time
                    dateTime={a.createdAt.toISOString()}
                    className="text-sm tabular-nums text-muted"
                  >
                    {when(a.createdAt)}
                  </time>
                  <span>{describe(a)}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-line bg-surface p-5 md:p-6"
    >
      <h2 id={`${id}-title`} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
