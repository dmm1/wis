import { getTranslations, setRequestLocale } from 'next-intl/server';
import { registry } from '@wis/modules';
import { Link } from '@/i18n/navigation';
import { NewTenantForm } from './new-tenant-form';

export default async function NewTenantPage({ params }: PageProps<'/[locale]/platform/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Platform.new');
  const tm = await getTranslations('Home.modules');
  const modules = registry
    .ids()
    .map((id) => ({ id, label: tm.has(id as never) ? tm(id as never) : id }));

  return (
    <>
      <Link
        href="/platform"
        className="text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        {t('back')}
      </Link>
      <h1 className="mt-3 text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
      <p className="mb-8 mt-2 max-w-prose text-muted">{t('subtitle')}</p>
      <NewTenantForm modules={modules} />
    </>
  );
}
