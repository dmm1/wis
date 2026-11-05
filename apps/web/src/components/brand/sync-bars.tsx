import { cn } from '@/lib/cn';

const rows = [
  { color: 'bg-early', width: '62%', off: '-38%', delay: '0ms' },
  { color: 'bg-day', width: '84%', off: '26%', delay: '90ms' },
  { color: 'bg-late', width: '46%', off: '-18%', delay: '180ms' },
  { color: 'bg-night', width: '70%', off: '34%', delay: '270ms' },
] as const;

/** Decorative: shift blocks that slide into alignment (the product promise, shown once). */
export function SyncBars({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('relative flex flex-col gap-2', className)}>
      <span className="absolute -left-2 bottom-0 top-0 w-px bg-line" />
      {rows.map((r, i) => (
        <span
          key={i}
          className={cn('sync-bar block h-2.5 rounded-full', r.color)}
          style={{ width: r.width, ['--off' as string]: r.off, ['--delay' as string]: r.delay }}
        />
      ))}
    </div>
  );
}
