import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { redirect } from '@/i18n/navigation';
import { getAppContext } from '@/lib/session';

export default async function AppLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx) redirect({ href: '/sign-in', locale });
  return <AppShell ctx={ctx!}>{children as ReactNode}</AppShell>;
}
