import { cn } from '@/lib/cn';

/**
 * Seats as shift blocks: filled = in use, dashed = reserved by a pending invitation, faint = free.
 * Visual only; the numbers are always stated in text next to it.
 */
export function SeatBlocks({
  used,
  reserved,
  max,
}: {
  used: number;
  reserved: number;
  max: number;
}) {
  if (max <= 0) return null;
  if (max > 60) {
    const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
    return (
      <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-full bg-line">
        <span className="bg-ink" style={{ width: pct(used) }} />
        <span className="bg-ink/40" style={{ width: pct(reserved) }} />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-1.5">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-5 w-3 rounded-[4px]',
            i < used
              ? 'bg-ink'
              : i < used + reserved
                ? 'border border-dashed border-ink/70'
                : 'bg-line',
          )}
        />
      ))}
    </div>
  );
}
