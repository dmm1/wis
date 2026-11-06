'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Lock } from 'lucide-react';
import { Field } from '@/components/ui/field';
import type { FieldView } from '@/lib/field-views';
import { cn } from '@/lib/cn';

/** Raw form state per field: strings for text-like inputs, booleans as 'yes'/'no'/'', arrays for multi-select. */
export type RawValue = string | string[];
export type RawValues = Record<string, RawValue>;

export function initialValues(fields: FieldView[], data: Record<string, unknown>): RawValues {
  const out: RawValues = {};
  for (const f of fields) {
    const v = data[f.key];
    if (f.type === 'multi_select') out[f.key] = Array.isArray(v) ? (v as string[]) : [];
    else if (f.type === 'boolean') out[f.key] = v === true ? 'yes' : v === false ? 'no' : '';
    else out[f.key] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/** Converts form state to the payload the server validates. Empty = null (clears the value). */
export function toPayload(fields: FieldView[], raw: RawValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = raw[f.key];
    if (f.type === 'multi_select') out[f.key] = (v as string[]).length ? v : null;
    else if (f.type === 'boolean') out[f.key] = v === 'yes' ? true : v === 'no' ? false : null;
    else if (f.type === 'number')
      out[f.key] = typeof v === 'string' && v.trim() !== '' ? Number(v) : null;
    else out[f.key] = typeof v === 'string' && v.trim() !== '' ? v : null;
  }
  return out;
}

interface Props {
  fields: FieldView[];
  values: RawValues;
  onChange: (key: string, value: RawValue) => void;
  /** Server issues by field key. */
  errors: Record<string, string>;
}

/** Renders one input per field, grouped by section. The inputs follow the tenant's field definitions. */
export function CustomFieldInputs({ fields, values, onChange, errors }: Props) {
  const t = useTranslations('Employees.form');
  const groups = new Map<string, FieldView[]>();
  for (const f of fields) {
    const name = f.section ?? '';
    groups.set(name, [...(groups.get(name) ?? []), f]);
  }

  return (
    <>
      {[...groups.entries()].map(([section, list]) => (
        <fieldset
          key={section}
          className="space-y-5 rounded-xl border border-line bg-surface p-5 md:p-6"
        >
          <legend className="px-1 text-lg font-semibold">{section || t('customDefault')}</legend>
          {list.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={values[f.key] ?? ''}
              onChange={(v) => onChange(f.key, v)}
              error={errors[f.key]}
            />
          ))}
        </fieldset>
      ))}
    </>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  error,
}: {
  field: FieldView;
  value: RawValue;
  onChange: (v: RawValue) => void;
  error: string | undefined;
}) {
  const t = useTranslations('Employees.form');
  const id = useId();
  const hint = field.sensitive ? (
    <span className="inline-flex items-center gap-1.5">
      <Lock className="size-3.5" aria-hidden="true" />
      {t('sensitiveHint')}
    </span>
  ) : undefined;

  if (field.type === 'select' || field.type === 'boolean') {
    const options =
      field.type === 'boolean'
        ? [
            { value: 'yes', label: t('yes') },
            { value: 'no', label: t('no') },
          ]
        : field.options;
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {field.label}
          {field.required ? <span aria-hidden="true"> *</span> : null}
        </label>
        <select
          id={id}
          value={value as string}
          required={field.required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-11 w-full rounded-lg border bg-surface px-3',
            error ? 'border-danger' : 'border-line',
          )}
        >
          <option value="">{field.required ? t('choose') : t('unset')}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
        {error ? (
          <p id={`${id}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (field.type === 'multi_select') {
    const selected = value as string[];
    return (
      <fieldset className="space-y-2" aria-describedby={error ? `${id}-error` : undefined}>
        <legend className="text-sm font-medium">{field.label}</legend>
        <div className="flex flex-wrap gap-2">
          {field.options.map((o) => (
            <label
              key={o.value}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface px-3.5"
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--ink)]"
                checked={selected.includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, o.value]
                      : selected.filter((x) => x !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
        {error ? (
          <p id={`${id}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }

  return (
    <Field
      label={field.required ? `${field.label} *` : field.label}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      step={field.type === 'number' ? 'any' : undefined}
      value={value as string}
      required={field.required}
      hint={hint}
      error={error}
      className={field.type === 'number' ? 'tabular-nums' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
