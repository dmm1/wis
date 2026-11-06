'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  CustomFieldInputs,
  initialValues,
  toPayload,
  type RawValue,
  type RawValues,
} from '@/components/custom-fields/custom-field-inputs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Link, useRouter } from '@/i18n/navigation';
import type { FieldView } from '@/lib/field-views';
import { issueKey } from '@/lib/validation-messages';
import { saveEmployeeAction } from './actions';

export interface EmployeeFormData {
  id?: string;
  firstName: string;
  lastName: string;
  email: string | null;
  personnelNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  customData: Record<string, unknown>;
}

const EMPTY: EmployeeFormData = {
  firstName: '',
  lastName: '',
  email: null,
  personnelNumber: null,
  startDate: null,
  endDate: null,
  customData: {},
};

const KNOWN = [
  'FORBIDDEN',
  'VALIDATION',
  'NOT_FOUND',
  'DUPLICATE_PERSONNEL_NUMBER',
  'SEAT_LIMIT_REACHED',
  'TENANT_NOT_ACTIVE',
];
const isEmpty = (v: RawValue | undefined) =>
  Array.isArray(v) ? v.length === 0 : (v ?? '').trim() === '';

export function EmployeeForm({
  fields,
  employee = EMPTY,
}: {
  fields: FieldView[];
  employee?: EmployeeFormData;
}) {
  const t = useTranslations('Employees.form');
  const te = useTranslations('Employees.errors');
  const tv = useTranslations('Employees.validation');
  const router = useRouter();
  const editing = Boolean(employee.id);
  const [base, setBase] = useState({
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email ?? '',
    personnelNumber: employee.personnelNumber ?? '',
    startDate: employee.startDate ?? '',
    endDate: employee.endDate ?? '',
  });
  const [custom, setCustom] = useState<RawValues>(() => initialValues(fields, employee.customData));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** Messages by field: base fields by name, custom fields as `custom:<key>`. */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clearError = (name: string) =>
    setErrors((e) => {
      if (!(name in e)) return e;
      const { [name]: _removed, ...rest } = e;
      void _removed;
      return rest;
    });
  const setField = (k: keyof typeof base) => (e: { target: { value: string } }) => {
    setBase((b) => ({ ...b, [k]: e.target.value }));
    clearError(k);
    setSaved(false);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    // Required fields are checked here first: no round trip for the most common mistake.
    const missing: Record<string, string> = {};
    if (isEmpty(base.firstName)) missing.firstName = tv('required');
    if (isEmpty(base.lastName)) missing.lastName = tv('required');
    for (const f of fields)
      if (f.required && isEmpty(custom[f.key])) missing[`custom:${f.key}`] = tv('required');
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return setError(te('VALIDATION'));
    }

    setPending(true);
    setErrors({});
    const res = await saveEmployeeAction({
      ...(employee.id ? { id: employee.id } : {}),
      values: { ...base, customData: toPayload(fields, custom) },
    });
    setPending(false);
    if (!res.ok) {
      const byField: Record<string, string> = {};
      for (const i of res.issues) {
        const name = i.path.startsWith('customData.') ? `custom:${i.path.slice(11)}` : i.path;
        const { key, values } = issueKey(i);
        byField[name] = tv(key, values as never);
      }
      setErrors(byField);
      return setError(te((KNOWN.includes(res.code) ? res.code : 'generic') as never));
    }
    if (editing) setSaved(true);
    else router.push('/employees');
  }

  const customErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith('custom:'))
      .map(([k, v]) => [k.slice(7), v]),
  );

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t('saved')}</Alert> : null}

      <fieldset className="space-y-5 rounded-xl border border-line bg-surface p-5 md:p-6">
        <legend className="px-1 text-lg font-semibold">{t('basic')}</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('firstName')}
            name="first-name"
            autoComplete="off"
            required
            value={base.firstName}
            error={errors.firstName}
            onChange={setField('firstName')}
          />
          <Field
            label={t('lastName')}
            name="last-name"
            autoComplete="off"
            required
            value={base.lastName}
            error={errors.lastName}
            onChange={setField('lastName')}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('email')}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={base.email}
            error={errors.email}
            onChange={setField('email')}
          />
          <Field
            label={t('personnelNumber')}
            autoComplete="off"
            value={base.personnelNumber}
            error={errors.personnelNumber}
            onChange={setField('personnelNumber')}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('startDate')}
            type="date"
            value={base.startDate}
            error={errors.startDate}
            onChange={setField('startDate')}
          />
          <Field
            label={t('endDate')}
            type="date"
            hint={t('endDateHint')}
            value={base.endDate}
            error={errors.endDate}
            onChange={setField('endDate')}
          />
        </div>
      </fieldset>

      <CustomFieldInputs
        fields={fields}
        values={custom}
        errors={customErrors}
        onChange={(k: string, v: RawValue) => {
          setCustom((c) => ({ ...c, [k]: v }));
          clearError(`custom:${k}`);
          setSaved(false);
        }}
      />

      <div className="flex gap-3">
        <Button type="submit" loading={pending}>
          {editing ? t('save') : t('create')}
        </Button>
        <Link
          href="/employees"
          className="inline-flex h-11 items-center rounded-lg px-4 font-medium text-ink hover:bg-ink/5"
        >
          {t('cancel')}
        </Link>
      </div>
    </form>
  );
}
