import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { registry } from '@wis/modules';
import { Logo, LogoMark } from '@/components/brand/logo';
import { Alert } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';
import { BLOCKED_STATUSES } from '@wis/auth';
import type { AppContext } from '@/lib/session';
import { NavLinks, type NavEntry } from './nav-links';
import { TenantSwitcher } from './tenant-switcher';
import { UserMenu } from './user-menu';

export async function AppShell({ ctx, children }: { ctx: AppContext; children: ReactNode }) {
  const t = await getTranslations('Shell');
  const tn = await getTranslations('Shell.nav');
  const nav = await buildNavigation(ctx, tn);
  const isAdminLike =
    ctx.isPlatformAdmin || (ctx.memberRole ?? '').split(',').includes('customer-admin');
  const needsTwoFactor = isAdminLike && !ctx.user.twoFactorEnabled;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 py-4 md:flex">
        <Link href="/" className="mb-6 block px-3" aria-label="WIS">
          <Logo />
        </Link>
        <nav aria-label={t('navLabel')}>
          <NavLinks items={nav} variant="rail" />
        </nav>
        <div className="mt-auto">
          <UserMenu name={ctx.user.name} email={ctx.user.email} variant="rail" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-paper/90 px-4 py-2 backdrop-blur md:px-8">
          <LogoMark className="shrink-0 md:hidden" />
          <TenantSwitcher workspaces={ctx.workspaces} activeId={ctx.activeId} />
          <div className="ml-auto md:hidden">
            <UserMenu name={ctx.user.name} email={ctx.user.email} variant="compact" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-10 md:pt-9">
          {needsTwoFactor ? (
            <Alert tone="info" className="mb-6">
              {t('twoFactorBanner')}{' '}
              <Link href="/settings/security" className="font-medium underline underline-offset-4">
                {t('twoFactorBannerAction')}
              </Link>
            </Alert>
          ) : null}
          {children}
        </main>
      </div>

      <nav
        aria-label={t('navLabel')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLinks items={nav} variant="tabs" />
      </nav>
    </div>
  );
}

/**
 * Navigation = base entries + entries contributed by the modules this workspace has enabled
 * (and only while the workspace is usable) + the platform area for platform admins.
 */
async function buildNavigation(
  ctx: AppContext,
  tn: Awaited<ReturnType<typeof getTranslations<'Shell.nav'>>>,
): Promise<NavEntry[]> {
  const items: NavEntry[] = [{ href: '/', label: tn('home'), icon: 'home' }];
  if (ctx.tenant && !BLOCKED_STATUSES.includes(ctx.tenant.status)) {
    for (const entry of registry.navigationFor(ctx.tenant.modules)) {
      const tm = await getTranslations(entry.moduleId);
      items.push({ href: entry.path, label: tm(entry.labelKey as never), icon: entry.icon });
    }
  }
  if (ctx.isPlatformAdmin)
    items.push({ href: '/platform', label: tn('platform'), icon: 'building-2' });
  items.push({ href: '/settings/security', label: tn('security'), icon: 'shield-check' });
  return items;
}
