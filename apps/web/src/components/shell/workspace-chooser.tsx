'use client';

import { Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import type { WorkspaceOption } from './tenant-switcher';

export function WorkspaceChooser({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const t = useTranslations('Shell');
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function choose(organizationId: string) {
    setPendingId(organizationId);
    await authClient.organization.setActive({ organizationId });
    router.refresh();
  }

  return (
    <section aria-labelledby="choose-title" className="max-w-md">
      <h1 id="choose-title" className="text-2xl font-bold">
        {t('chooseWorkspace')}
      </h1>
      <p className="mb-6 mt-2 text-muted">{t('chooseWorkspaceHint')}</p>
      <ul className="space-y-2">
        {workspaces.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => choose(w.id)}
              disabled={pendingId !== null}
              aria-busy={pendingId === w.id || undefined}
              className="flex h-14 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left font-medium transition-colors hover:border-muted/60 disabled:opacity-60"
            >
              <Building2 className="size-5 text-muted" aria-hidden="true" />
              {w.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
