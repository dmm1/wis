'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { useRouter } from '@/i18n/navigation';
import {
  resendInvitationAction,
  setStatusAction,
  updateModulesAction,
  updateSeatsAction,
  type ActionResult,
} from '../actions';

function useAction() {
  const te = useTranslations('Platform.errors');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function run(fn: () => Promise<ActionResult<object>>) {
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      setError(te(res.code as never));
      return false;
    }
    setSaved(true);
    router.refresh();
    return true;
  }
  return { pending, error, saved, run };
}

/* ----------------------------------------------------------------- status */

type Status = 'trial' | 'active' | 'suspended' | 'offboarding';
const DESTRUCTIVE: Status[] = ['suspended', 'offboarding'];

export function StatusControls({ tenantId, allowed }: { tenantId: string; allowed: Status[] }) {
  const t = useTranslations('Platform.detail.statusActions');
  const { pending, error, run } = useAction();
  const [confirming, setConfirming] = useState<Status | null>(null);

  if (allowed.length === 0) return <p className="text-muted">{t('none')}</p>;

  async function apply(status: Status) {
    const ok = await run(() => setStatusAction({ tenantId, status }));
    if (ok) setConfirming(null);
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {confirming ? (
        <div
          className="space-y-4 rounded-lg border border-line bg-paper p-4"
          role="group"
          aria-label={t('confirmTitle')}
        >
          <p className="max-w-prose">{t(`confirm.${confirming}` as never)}</p>
          <div className="flex gap-3">
            <Button variant="danger" loading={pending} onClick={() => apply(confirming)}>
              {t(`do.${confirming}` as never)}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {allowed.map((s) => (
            <Button
              key={s}
              variant={DESTRUCTIVE.includes(s) ? 'secondary' : 'primary'}
              loading={pending}
              onClick={() => (DESTRUCTIVE.includes(s) ? setConfirming(s) : apply(s))}
            >
              {t(`do.${s}` as never)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ seats */

export function SeatsForm({
  tenantId,
  maxSeats,
  inUse,
}: {
  tenantId: string;
  maxSeats: number;
  inUse: number;
}) {
  const t = useTranslations('Platform.detail.seats');
  const { pending, error, saved, run } = useAction();
  const [value, setValue] = useState(String(maxSeats));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(() => updateSeatsAction({ tenantId, maxSeats: Number(value) }));
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
      <Field
        label={t('label')}
        hint={t('hint', { count: inUse })}
        type="number"
        min={Math.max(1, inUse)}
        max={100000}
        inputMode="numeric"
        className="tabular-nums"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" loading={pending} disabled={Number(value) === maxSeats}>
        {t('save')}
      </Button>
    </form>
  );
}

/* ---------------------------------------------------------------- modules */

export function ModulesForm({
  tenantId,
  available,
  enabled,
}: {
  tenantId: string;
  available: { id: string; label: string }[];
  enabled: string[];
}) {
  const t = useTranslations('Platform.detail.modules');
  const { pending, error, saved, run } = useAction();
  const [selected, setSelected] = useState<string[]>(enabled);
  const dirty = [...selected].sort().join() !== [...enabled].sort().join();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(() => updateModulesAction({ tenantId, modules: selected }));
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
      <fieldset className="space-y-2">
        <legend className="sr-only">{t('legend')}</legend>
        {available.map((m) => (
          <label
            key={m.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3.5"
          >
            <input
              type="checkbox"
              className="size-4 accent-[var(--ink)]"
              checked={selected.includes(m.id)}
              onChange={(e) =>
                setSelected((cur) =>
                  e.target.checked ? [...cur, m.id] : cur.filter((x) => x !== m.id),
                )
              }
            />
            {m.label}
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-muted">{t('hint')}</p>
      <Button type="submit" loading={pending} disabled={!dirty}>
        {t('save')}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------ invitations */

export function ResendButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations('Platform.detail.people');
  const { pending, error, saved, run } = useAction();
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        variant="secondary"
        loading={pending}
        onClick={() => run(() => resendInvitationAction({ invitationId }))}
      >
        {t('resend')}
      </Button>
      {saved ? (
        <span role="status" className="text-sm text-success">
          {t('resent')}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
