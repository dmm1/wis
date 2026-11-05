'use client';

import { Copy, Fingerprint, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { errorKey } from '@/lib/auth-errors';

function Panel({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line bg-surface p-5 md:p-6">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mb-5 mt-1 max-w-prose text-muted">{description}</p>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ passkeys */

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
}

export function PasskeyPanel() {
  const t = useTranslations('Security.passkeys');
  const te = useTranslations('Errors');
  const format = useFormatter();
  const [items, setItems] = useState<PasskeyRow[] | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authClient.passkey.listUserPasskeys();
    setItems((res.data as PasskeyRow[] | null) ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await authClient.passkey.addPasskey({ name: name.trim() || t('defaultName') });
    if (res?.error) setError(te(errorKey(res.error)));
    else {
      setName('');
      await load();
    }
    setPending(false);
  }

  async function remove(id: string) {
    setError(null);
    const res = await authClient.passkey.deletePasskey({ id });
    if (res.error) setError(te(errorKey(res.error)));
    await load();
  }

  return (
    <Panel id="passkeys" title={t('title')} description={t('description')}>
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="mb-5 divide-y divide-line rounded-lg border border-line">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <Fingerprint className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name || t('defaultName')}</p>
                {p.createdAt ? (
                  <p className="text-sm text-muted">
                    {t('added', {
                      date: format.dateTime(new Date(p.createdAt), { dateStyle: 'medium' }),
                    })}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                aria-label={t('remove', { name: p.name || t('defaultName') })}
                onClick={() => remove(p.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : items ? (
        <p className="mb-5 text-muted">{t('empty')}</p>
      ) : null}
      <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-72">
          <Field
            label={t('nameLabel')}
            name="passkey-name"
            placeholder={t('namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" loading={pending}>
          {t('add')}
        </Button>
      </form>
    </Panel>
  );
}

/* ----------------------------------------------------------------- two-factor */

type TwoFactorStep = 'idle' | 'password' | 'scan' | 'codes' | 'disable';

export function TwoFactorPanel({ enabled, email }: { enabled: boolean; email: string }) {
  const t = useTranslations('Security.twoFactor');
  const te = useTranslations('Errors');
  const router = useRouter();
  const [step, setStep] = useState<TwoFactorStep>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setStep('idle');
    setPassword('');
    setCode('');
    setError(null);
    setPending(false);
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await authClient.twoFactor.enable({ password, issuer: 'WIS' });
    if (res.error || !res.data || !('totpURI' in res.data)) {
      setError(te(errorKey(res.error)));
      setPending(false);
      return;
    }
    const uri = res.data.totpURI;
    setSecret(new URL(uri).searchParams.get('secret'));
    setQr(await QRCode.toDataURL(uri, { margin: 1, width: 192 })); // generated locally, never sent anywhere
    setCodes(res.data.backupCodes);
    setPassword('');
    setStep('scan');
    setPending(false);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, '') });
    if (res.error) {
      setError(te(errorKey(res.error)));
      setPending(false);
      return;
    }
    setStep('codes');
    setPending(false);
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await authClient.twoFactor.disable({ password });
    if (res.error) {
      setError(te(errorKey(res.error)));
      setPending(false);
      return;
    }
    reset();
    router.refresh();
  }

  async function copyCodes() {
    await navigator.clipboard.writeText(codes.join('\n')).catch(() => null);
    setCopied(true);
  }

  return (
    <Panel id="two-factor" title={t('title')} description={t('description')}>
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}

      {step === 'idle' && !enabled ? (
        <Button onClick={() => setStep('password')}>{t('setup')}</Button>
      ) : null}
      {step === 'idle' && enabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-8 items-center rounded-full bg-success-soft px-3 text-sm font-medium text-success">
            {t('on')}
          </span>
          <Button variant="secondary" onClick={() => setStep('disable')}>
            {t('disable')}
          </Button>
        </div>
      ) : null}

      {step === 'password' || step === 'disable' ? (
        <form onSubmit={step === 'password' ? start : disable} className="max-w-sm space-y-4">
          <Field
            label={t('confirmPassword')}
            hint={step === 'password' ? t('confirmPasswordHint') : undefined}
            type="password"
            name="current-password"
            autoComplete="current-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-3">
            <Button
              type="submit"
              loading={pending}
              variant={step === 'disable' ? 'danger' : 'primary'}
            >
              {step === 'password' ? t('continue') : t('disableConfirm')}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'scan' ? (
        <form onSubmit={verify} className="space-y-5">
          <div className="flex flex-col gap-5 sm:flex-row">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt={t('qrAlt', { email })}
                width={192}
                height={192}
                className="size-48 rounded-lg border border-line bg-white p-2"
              />
            ) : null}
            <div className="min-w-0 space-y-3">
              <p className="max-w-prose">{t('scanHelp')}</p>
              {secret ? (
                <p className="text-sm text-muted">
                  {t('manualKey')}{' '}
                  <code className="break-all rounded bg-paper px-1.5 py-0.5 text-ink">
                    {secret}
                  </code>
                </p>
              ) : null}
            </div>
          </div>
          <div className="max-w-xs">
            <Field
              label={t('codeLabel')}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="tracking-widest tabular-nums"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <Button type="submit" loading={pending}>
              {t('verify')}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'codes' ? (
        <div className="space-y-4">
          <Alert tone="success">{t('enabled')}</Alert>
          <div>
            <h3 className="font-semibold">{t('backupTitle')}</h3>
            <p className="mt-1 max-w-prose text-muted">{t('backupHelp')}</p>
          </div>
          <ul className="grid max-w-md grid-cols-2 gap-2 font-mono text-sm tabular-nums">
            {codes.map((c) => (
              <li key={c} className="rounded-lg bg-paper px-3 py-2">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={copyCodes}>
              <Copy className="size-4" aria-hidden="true" />
              {copied ? t('copied') : t('copy')}
            </Button>
            <Button
              onClick={() => {
                reset();
                router.refresh();
              }}
            >
              {t('savedThem')}
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------- password */

export function PasswordPanel() {
  const t = useTranslations('Security.password');
  const te = useTranslations('Errors');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setDone(false);
    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (res.error) setError(te(errorKey(res.error)));
    else {
      setDone(true);
      setCurrent('');
      setNext('');
    }
    setPending(false);
  }

  return (
    <Panel id="password" title={t('title')} description={t('description')}>
      <form onSubmit={submit} className="max-w-sm space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">{t('done')}</Alert> : null}
        <Field
          label={t('current')}
          type="password"
          name="current-password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label={t('new')}
          hint={t('hint')}
          type="password"
          name="new-password"
          autoComplete="new-password"
          minLength={12}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Button type="submit" loading={pending}>
          {t('submit')}
        </Button>
      </form>
    </Panel>
  );
}
