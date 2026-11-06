import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { withTenant } from '@wis/db';
import { listFieldDefinitions } from '@wis/people';
import { TenantGate } from '@/components/shell/tenant-gate';
import { redirect } from '@/i18n/navigation';
import { getRequestActor } from '@/lib/actor';
import { getAuthContext } from '@/lib/auth';
import { getAppContext } from '@/lib/session';
import { FieldsManager, type AdminField } from './fields-manager';

export default async function FieldsPage({ params }: PageProps<'/[locale]/settings/fields'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  return (
    <TenantGate ctx={ctx!}>
      <Content />
    </TenantGate>
  );
}

async function Content() {
  const ra = await getRequestActor();
  if (!ra || !ra.actor.can('organization', 'update')) notFound();
  const t = await getTranslations('Fields');
  const defs = await withTenant(getAuthContext().appDb, ra!.tenantId, (tx) =>
    listFieldDefinitions(tx, ra!.tenantId, 'employee', { includeArchived: true }),
  );
  const fields: AdminField[] = defs.map((d) => ({
    id: d.id,
    key: d.key,
    type: d.type,
    label: d.label,
    required: d.required,
    sensitive: d.sensitive,
    section: d.section,
    sortOrder: d.sortOrder,
    options: d.options,
    validation: d.validation,
    archived: d.archivedAt !== null,
  }));
  return (
    <>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
      <p className="mb-8 mt-2 max-w-prose text-muted">{t('subtitle')}</p>
      <FieldsManager fields={fields} />
    </>
  );
}
