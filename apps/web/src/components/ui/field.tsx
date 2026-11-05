'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  /** Rendered to the right of the label, e.g. "Forgot password?". */
  labelAction?: ReactNode;
}

export function Field({ label, hint, error, labelAction, className, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {labelAction}
      </div>
      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-11 w-full rounded-lg border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70',
          'disabled:cursor-not-allowed disabled:bg-paper disabled:text-muted',
          error ? 'border-danger' : 'border-line hover:border-muted/60',
          className,
        )}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
