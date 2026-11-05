import { PauseCircle, UserRoundX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BLOCKED_STATUSES } from '@wis/auth';
import type { AppContext } from '@/lib/session';
import { WorkspaceChooser } from './workspace-chooser';

/**
 * Request-level tenant gate for tenant pages. Renders a clear state instead of the page when the
 * user has no workspace, hasn't picked one, or the workspace is suspended / being offboarded.
 */
export async function TenantGate({ ctx, children }: { ctx: AppContext; children: ReactNode }) {
  const t = await getTranslations('Gate');

  if (ctx.workspaces.length === 0) {
    return ctx.isPlatformAdmin ? (
      <Notice
        icon={<UserRoundX className="size-5" aria-hidden="true" />}
        title={t('platformTitle')}
      >
        {t('platformBody')}
      </Notice>
    ) : (
      <Notice
        icon={<UserRoundX className="size-5" aria-hidden="true" />}
        title={t('noWorkspaceTitle')}
      >
        {t('noWorkspaceBody')}
      </Notice>
    );
  }
  if (!ctx.activeId) return <WorkspaceChooser workspaces={ctx.workspaces} />;

  if (!ctx.tenant || BLOCKED_STATUSES.includes(ctx.tenant.status)) {
    return (
      <Notice icon={<PauseCircle className="size-5" aria-hidden="true" />} title={t('pausedTitle')}>
        {t('pausedBody', { name: ctx.workspaces.find((w) => w.id === ctx.activeId)?.name ?? '' })}
      </Notice>
    );
  }
  return <>{children}</>;
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="max-w-lg rounded-xl border border-line bg-surface p-6">
      <div className="mb-3 flex items-center gap-2.5 text-muted">{icon}</div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-muted">{children}</p>
    </section>
  );
}
