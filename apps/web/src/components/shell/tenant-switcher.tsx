'use client';

import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/cn';

export interface WorkspaceOption {
  id: string;
  name: string;
}

export function TenantSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceOption[];
  activeId: string | null;
}) {
  const t = useTranslations('Shell');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const active = workspaces.find((w) => w.id === activeId);
  if (workspaces.length === 0) return null;

  async function select(organizationId: string) {
    if (organizationId === activeId) return;
    setPending(true);
    await authClient.organization.setActive({ organizationId });
    router.replace('/');
    router.refresh();
    setPending(false);
  }

  const label = (
    <>
      <Building2 className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium">{active?.name ?? t('chooseWorkspace')}</span>
    </>
  );

  if (workspaces.length === 1) {
    return <div className="flex h-10 min-w-0 items-center gap-2 px-1">{label}</div>;
  }

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        aria-label={t('switchWorkspace')}
        disabled={pending}
        className="flex h-10 min-w-0 max-w-full items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-ink/5 data-[state=open]:bg-ink/5"
      >
        {label}
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          <Dropdown.Label className="px-2.5 py-1.5 text-sm text-muted">
            {t('workspaces')}
          </Dropdown.Label>
          {workspaces.map((w) => (
            <Dropdown.Item
              key={w.id}
              onSelect={() => select(w.id)}
              className={cn(
                'flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 text-[0.9375rem] outline-none',
                'data-[highlighted]:bg-ink/5',
              )}
            >
              <span className="truncate">{w.name}</span>
              {w.id === activeId ? (
                <Check className="size-4 shrink-0 text-day" aria-hidden="true" />
              ) : null}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
