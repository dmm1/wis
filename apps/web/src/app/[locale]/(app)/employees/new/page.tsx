import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { withTenant } from '@wis/db';
import { listFieldDefinitions } from '@wis/people';
import { TenantGate } from '@/components/shell/tenant-gate';
import { Link, redirect } from '@/i18n/navigation';
import { getRequestActor } from '@/lib/actor';
import { getAuthContext } from '@/lib/auth';
import { toFieldViews } from '@/lib/field-views';
import { getAppContext } from '@/lib/session';
import { EmployeeForm } from '../employee-form';

export default async function NewEmployeePage({ params }: PageProps<'/[locale]/employees/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  return (
    <TenantGate ctx={ctx!}>
      <Content locale={locale} />
    </TenantGate>
  );
}

async function Content({ locale }: { locale: string }) {
  const ra = await getRequestActor();
  if (!ra || !ra.actor.can('employee', 'create')) notFound();
  const t = await getTranslations('Employees.form');
  const defs = await withTenant(getAuthContext().appDb, ra!.tenantId, (tx) =>
    listFieldDefinitions(tx, ra!.tenantId, 'employee'),
  );
  const canSensitive = ra!.actor.can('employee', 'read-sensitive');
  const fields = toFieldViews(
    defs.filter((d) => canSensitive || !d.sensitive),
    locale,
  );
  return (
    <>
      <Link
        href="/employees"
        className="text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        {t('backList')}
      </Link>
      <h1 className="mb-8 mt-3 text-[1.75rem] font-bold sm:text-3xl">{t('newTitle')}</h1>
      <EmployeeForm fields={fields} />
    </>
  );
}
