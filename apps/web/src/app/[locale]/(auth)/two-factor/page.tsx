import { getTranslations, setRequestLocale } from 'next-intl/server';
import { safeNext } from '@/lib/safe-next';
import { TwoFactorForm } from './two-factor-form';

export default async function TwoFactorPage({
  params,
  searchParams,
}: PageProps<'/[locale]/two-factor'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next as string | undefined);
  const t = await getTranslations('Auth.twoFactor');
  return (
    <>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
      <TwoFactorForm next={next} />
    </>
  );
}
