'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { useRouter } from '@/i18n/navigation';
import { createTenantAction } from '../actions';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

export function NewTenantForm({ modules }: { modules: { id: string; label: string }[] }) {
  const t = useTranslations('Platform.new');
  const te = useTranslations('Platform.errors');
  const uiLocale = useLocale() as 'en' | 'de';
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [maxSeats, setMaxSeats] = useState('10');
  const [mailLocale, setMailLocale] = useState<'en' | 'de'>(uiLocale);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string | undefined } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await createTenantAction({
      name,
      slug,
      adminEmail,
      maxSeats: Number(maxSeats),
      modules: enabled,
      locale: mailLocale,
      trialDays: 30,
    });
    if (!res.ok) {
      setError({ message: te(res.code as never), field: res.field });
      setPending(false);
      return;
    }
    router.push(
      `/platform/${(res as { tenantId: string }).tenantId}${(res as { emailSent: boolean }).emailSent ? '' : '?mail=failed'}`,
    );
  }

  const fieldError = (f: string) => (error?.field === f ? error.message : null);

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-6" noValidate>
      {error && !error.field ? <Alert tone="error">{error.message}</Alert> : null}
      <Field
        label={t('name')}
        name="name"
        required
        value={name}
        error={fieldError('name')}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
      />
      <Field
        label={t('slug')}
        hint={t('slugHint')}
        name="slug"
        required
        value={slug}
        error={fieldError('slug')}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(slugify(e.target.value));
        }}
      />
      <Field
        label={t('adminEmail')}
        hint={t('adminEmailHint')}
        type="email"
        name="admin-email"
        inputMode="email"
        required
        value={adminEmail}
        error={fieldError('adminEmail')}
        onChange={(e) => setAdminEmail(e.target.value)}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label={t('seats')}
          type="number"
          min={1}
          max={100000}
          inputMode="numeric"
          required
          className="tabular-nums"
          value={maxSeats}
          error={fieldError('maxSeats')}
          onChange={(e) => setMaxSeats(e.target.value)}
        />
        <div className="space-y-1.5">
          <label htmlFor="mail-locale" className="text-sm font-medium">
            {t('mailLanguage')}
          </label>
          <select
            id="mail-locale"
            value={mailLocale}
            onChange={(e) => setMailLocale(e.target.value as 'en' | 'de')}
            className="h-11 w-full rounded-lg border border-line bg-surface px-3"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('modules')}</legend>
        {modules.map((m) => (
          <label
            key={m.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3.5"
          >
            <input
              type="checkbox"
              className="size-4 accent-[var(--ink)]"
              checked={enabled.includes(m.id)}
              onChange={(e) =>
                setEnabled((cur) =>
                  e.target.checked ? [...cur, m.id] : cur.filter((x) => x !== m.id),
                )
              }
            />
            {m.label}
          </label>
        ))}
      </fieldset>

      <Button type="submit" loading={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
