import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import { redirect } from '@/i18n/navigation';
import { getAppContext } from '@/lib/session';
import { PasskeyPanel, PasswordPanel, TwoFactorPanel } from './security-panels';

export default async function SecurityPage({
  params,
  searchParams,
}: PageProps<'/[locale]/settings/security'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  const sp = await searchParams;
  const t = await getTranslations('Security');

  return (
    <>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-prose text-muted">{t('subtitle')}</p>
      {sp.welcome ? (
        <Alert tone="success" className="mt-6">
          {t('welcome', {
            workspace: ctx!.workspaces.find((w) => w.id === ctx!.activeId)?.name ?? 'WIS',
          })}
        </Alert>
      ) : null}
      <div className="mt-8 space-y-5">
        <PasskeyPanel />
        <TwoFactorPanel enabled={ctx!.user.twoFactorEnabled} email={ctx!.user.email} />
        <PasswordPanel />
      </div>
    </>
  );
}
