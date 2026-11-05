import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

const DOT: Record<string, string> = {
  trial: 'bg-day',
  active: 'bg-success',
  suspended: 'bg-late',
  offboarding: 'bg-muted',
};

/** Colour is never the only signal: the label always says the status. */
export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('Platform.status');
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm">
      <span className={cn('size-2 rounded-full', DOT[status] ?? 'bg-muted')} aria-hidden="true" />
      {t(status as never)}
    </span>
  );
}
