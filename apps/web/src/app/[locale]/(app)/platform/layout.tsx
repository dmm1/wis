import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getAppContext } from '@/lib/session';

/** Platform area: platform admins only. Everyone else gets a plain 404 (it doesn't "exist" for them). */
export default async function PlatformLayout({
  children,
  params,
}: LayoutProps<'/[locale]/platform'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await getAppContext();
  if (!ctx?.isPlatformAdmin) notFound();
  return <>{children as ReactNode}</>;
}
