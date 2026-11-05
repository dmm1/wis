import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ForgotPasswordForm } from './forgot-password-form';

export default async function ForgotPasswordPage({
  params,
}: PageProps<'/[locale]/forgot-password'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth.forgot');
  return (
    <>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
      <p className="mb-7 mt-2 text-muted">{t('subtitle')}</p>
      <ForgotPasswordForm />
    </>
  );
}
