import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { safeNext } from '@/lib/safe-next';
import { SignInForm } from './sign-in-form';

export default async function SignInPage({ params, searchParams }: PageProps<'/[locale]/sign-in'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next as string | undefined);
  if (await getSession()) redirect({ href: next, locale });

  const t = await getTranslations('Auth.signIn');
  return (
    <>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
      <p className="mb-7 mt-2 text-muted">{t('subtitle')}</p>
      <SignInForm next={next} />
    </>
  );
}
