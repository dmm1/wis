import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';
import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  params,
  searchParams,
}: PageProps<'/[locale]/reset-password'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : null;
  const invalid = !token || sp.error === 'INVALID_TOKEN';
  const t = await getTranslations('Auth.reset');
  return (
    <>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
      <div className="mt-6">
        {invalid ? (
          <div className="space-y-5">
            <Alert tone="error">{t('invalid')}</Alert>
            <Link href="/forgot-password" className="text-sm underline underline-offset-4">
              {t('requestNew')}
            </Link>
          </div>
        ) : (
          <ResetPasswordForm token={token} />
        )}
      </div>
    </>
  );
}
