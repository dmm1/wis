import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getEmployeeLogin, listLinkableMembers } from '@wis/auth';
import { withTenant } from '@wis/db';
import { getEmployee, listFieldDefinitions, PeopleError } from '@wis/people';
import { TenantGate } from '@/components/shell/tenant-gate';
import { Link, redirect } from '@/i18n/navigation';
import { getRequestActor } from '@/lib/actor';
import { getAuthContext } from '@/lib/auth';
import { toFieldViews } from '@/lib/field-views';
import { getAppContext } from '@/lib/session';
import { EmployeeForm } from '../employee-form';
import { LoginPanel } from '../login-panel';

export default async function EmployeePage({ params }: PageProps<'/[locale]/employees/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  return (
    <TenantGate ctx={ctx!}>
      <Content locale={locale} id={id} />
    </TenantGate>
  );
}

async function Content({ locale, id }: { locale: string; id: string }) {
  const ra = await getRequestActor();
  if (!ra || !ra.actor.can('employee', 'read')) notFound();
  const { actor, tenantId } = ra!;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { appDb, db } = getAuthContext();
  const t = await getTranslations('Employees.form');

  const data = await withTenant(appDb, tenantId, async (tx) => {
    try {
      const employee = await getEmployee(tx, actor, id);
      const defs = await listFieldDefinitions(tx, tenantId, 'employee');
      return { employee, defs };
    } catch (e) {
      if (e instanceof PeopleError && e.code === 'NOT_FOUND') return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { employee, defs } = data!;

  const canWrite = actor.can('employee', 'update');
  const canSensitive = actor.can('employee', 'read-sensitive');
  const fields = toFieldViews(
    defs.filter((d) => canSensitive || !d.sensitive),
    locale,
  );
  const [linked, available] = canWrite
    ? await Promise.all([getEmployeeLogin(db, tenantId, id), listLinkableMembers(db, tenantId)])
    : [null, []];

  return (
    <>
      <Link
        href="/employees"
        className="text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        {t('backList')}
      </Link>
      <h1 className="mb-8 mt-3 text-[1.75rem] font-bold sm:text-3xl">
        {t('editTitle', { name: `${employee.firstName} ${employee.lastName}` })}
      </h1>
      <div className="space-y-6">
        {canWrite ? (
          <>
            <EmployeeForm fields={fields} employee={employee} />
            <LoginPanel employeeId={id} linked={linked} available={available} />
          </>
        ) : (
          <p className="text-muted">{t('readOnly')}</p>
        )}
      </div>
    </>
  );
}
