import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { SyncBars } from '@/components/brand/sync-bars';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Logo showTagline />
        <LocaleSwitcher />
      </header>
      <main className="grid flex-1 place-items-start px-5 pb-16 pt-6 sm:place-items-center sm:pt-0">
        <div className="w-full max-w-[26rem]">
          <SyncBars className="mb-9 w-44" />
          {children}
        </div>
      </main>
    </div>
  );
}
