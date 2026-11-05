import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'error' | 'success' | 'info';

const tones: Record<Tone, { box: string; Icon: typeof Info }> = {
  error: { box: 'bg-danger-soft text-danger', Icon: AlertCircle },
  success: { box: 'bg-success-soft text-success', Icon: CheckCircle2 },
  info: { box: 'bg-ink/5 text-ink', Icon: Info },
};

/** Errors are announced to screen readers; success/info are polite. */
export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const { box, Icon } = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
