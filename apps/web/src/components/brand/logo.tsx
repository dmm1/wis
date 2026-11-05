import { cn } from '@/lib/cn';

/** Mark: three shift blocks aligned on a common start line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-6', className)}>
      <rect x="3" y="4" width="14" height="4" rx="2" fill="var(--early)" />
      <rect x="3" y="10" width="18" height="4" rx="2" fill="var(--day)" />
      <rect x="3" y="16" width="10" height="4" rx="2" fill="var(--night)" />
    </svg>
  );
}

export function Logo({
  className,
  showTagline = false,
}: {
  className?: string;
  showTagline?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <div className="leading-none">
        <span className="font-display text-xl font-bold tracking-tight">WIS</span>
        {showTagline ? (
          <span className="mt-1 block text-xs text-muted">Workforce, in sync</span>
        ) : null}
      </div>
    </div>
  );
}
