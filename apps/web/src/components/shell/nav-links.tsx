'use client';

import {
  Building2,
  CalendarDays,
  Home,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

export interface NavEntry {
  href: string;
  label: string;
  /** lucide icon name in kebab-case; unknown names fall back to a neutral icon. */
  icon: string;
}

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  'shield-check': ShieldCheck,
  'calendar-days': CalendarDays,
  'building-2': Building2,
  users: Users,
  'sliders-horizontal': SlidersHorizontal,
};

export function NavLinks({ items, variant }: { items: NavEntry[]; variant: 'rail' | 'tabs' }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <ul className={cn(variant === 'rail' ? 'space-y-1' : 'grid grid-flow-col auto-cols-fr')}>
      {items.map(({ href, label, icon }) => {
        const active = isActive(href);
        const Icon = ICONS[icon] ?? Home;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center transition-colors',
                variant === 'rail'
                  ? 'h-10 gap-3 rounded-lg px-3 text-[0.9375rem]'
                  : 'h-14 flex-col justify-center gap-0.5 text-xs',
                active
                  ? variant === 'rail'
                    ? 'bg-ink text-on-ink'
                    : 'font-semibold text-ink'
                  : 'text-muted hover:text-ink',
              )}
            >
              <Icon
                className={cn('size-[1.125rem]', variant === 'tabs' && active && 'text-day')}
                aria-hidden="true"
              />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
