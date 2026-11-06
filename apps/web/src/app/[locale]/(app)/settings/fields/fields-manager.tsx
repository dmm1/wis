'use client';

import { Archive, Lock, Pencil, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { useRouter } from '@/i18n/navigation';
import { localize, type FieldType, type FieldValidation, type LocalizedText } from '@wis/core';
import {
  archiveFieldAction,
  createFieldAction,
  updateFieldAction,
  type FieldResult,
} from './actions';

export interface AdminField {
  id: string;
  key: string;
  type: FieldType;
  label: LocalizedText;
  required: boolean;
  sensitive: boolean;
  section: string | null;
  sortOrder: number;
  options: { value: string; labels: LocalizedText }[];
  validation: FieldValidation;
  archived: boolean;
}

const TYPES: FieldType[] = ['text', 'number', 'date', 'boolean', 'select', 'multi_select'];
const KNOWN = [
  'FORBIDDEN',
  'VALIDATION',
  'DUPLICATE_KEY',
  'TOO_MANY_FIELDS',
  'IMMUTABLE_FIELD',
  'OPTION_REMOVED',
  'NOT_FOUND',
  'UNKNOWN_ENTITY',
];

const slug = (s: string, sep = '_') =>
  s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '')
    .slice(0, 40);

export function FieldsManager({ fields }: { fields: AdminField[] }) {
  const t = useTranslations('Fields');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const nextOrder = (fields.reduce((m, f) => Math.max(m, f.sortOrder), 0) || 0) + 10;

  return (
    <div className="max-w-3xl space-y-5">
      {adding ? (
        <FieldForm
          mode="create"
          initial={null}
          nextOrder={nextOrder}
          onDone={() => setAdding(false)}
        />
      ) : (
        <Button onClick={() => setAdding(true)}>{t('add')}</Button>
      )}

      {fields.length === 0 ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">{t('emptyTitle')}</h2>
          <p className="mt-2 text-muted">{t('emptyBody')}</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {fields.map((f) => (
            <li key={f.id} className="rounded-xl border border-line bg-surface">
              <FieldRow
                field={f}
                editing={editing === f.id}
                onEdit={() => setEditing(editing === f.id ? null : f.id)}
              />
              {editing === f.id ? (
                <div className="border-t border-line p-4 md:p-5">
                  <FieldForm
                    mode="edit"
                    initial={f}
                    nextOrder={nextOrder}
                    onDone={() => setEditing(null)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldRow({
  field,
  editing,
  onEdit,
}: {
  field: AdminField;
  editing: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('Fields');
  const te = useTranslations('Fields.errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleArchive() {
    setPending(true);
    setError(null);
    const res = await archiveFieldAction({ id: field.id, archived: !field.archived });
    setPending(false);
    if (!res.ok) return setError(te((KNOWN.includes(res.code) ? res.code : 'generic') as never));
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4 md:px-5">
      <div className="min-w-0">
        <p
          className={
            field.archived ? 'truncate font-medium text-muted line-through' : 'truncate font-medium'
          }
        >
          {localize(field.label, locale)}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <code className="rounded bg-paper px-1.5 py-0.5 text-ink">{field.key}</code>
          <span>{t(`types.${field.type}`)}</span>
          {field.required ? <span>· {t('requiredBadge')}</span> : null}
          {field.sensitive ? (
            <span className="inline-flex items-center gap-1">
              · <Lock className="size-3" aria-hidden="true" />
              {t('sensitiveBadge')}
            </span>
          ) : null}
          {field.archived ? <span>· {t('archivedBadge')}</span> : null}
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        {!field.archived ? (
          <Button variant="secondary" onClick={onEdit} aria-expanded={editing}>
            <Pencil className="size-4" aria-hidden="true" />
            {t('edit')}
          </Button>
        ) : null}
        <Button variant="ghost" loading={pending} onClick={toggleArchive}>
          {field.archived ? (
            <RotateCcw className="size-4" aria-hidden="true" />
          ) : (
            <Archive className="size-4" aria-hidden="true" />
          )}
          {field.archived ? t('restore') : t('archive')}
        </Button>
      </div>
    </div>
  );
}

function FieldForm({
  mode,
  initial,
  nextOrder,
  onDone,
}: {
  mode: 'create' | 'edit';
  initial: AdminField | null;
  nextOrder: number;
  onDone: () => void;
}) {
  const t = useTranslations('Fields.form');
  const tt = useTranslations('Fields.types');
  const te = useTranslations('Fields.errors');
  const router = useRouter();
  const editing = mode === 'edit';

  const [labelEn, setLabelEn] = useState(initial?.label.en ?? '');
  const [labelDe, setLabelDe] = useState(initial?.label.de ?? '');
  const [key, setKey] = useState(initial?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(editing);
  const [type, setType] = useState<FieldType>(initial?.type ?? 'text');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [sensitive, setSensitive] = useState(initial?.sensitive ?? false);
  const [section, setSection] = useState(initial?.section ?? '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? nextOrder));
  const [optionsText, setOptionsText] = useState(
    (initial?.options ?? []).map((o) => `${o.labels.en} | ${o.labels.de}`).join('\n'),
  );
  const [maxLength, setMaxLength] = useState(
    initial?.validation.maxLength !== undefined ? String(initial.validation.maxLength) : '',
  );
  const [min, setMin] = useState(
    initial?.validation.min !== undefined ? String(initial.validation.min) : '',
  );
  const [max, setMax] = useState(
    initial?.validation.max !== undefined ? String(initial.validation.max) : '',
  );
  const [integer, setInteger] = useState(initial?.validation.integer ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<Set<string>>(new Set());

  const isSelect = type === 'select' || type === 'multi_select';

  function buildOptions() {
    const used = new Set<string>();
    return optionsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [en, de] = line.split('|').map((p) => p.trim());
        const existing = initial?.options[i];
        let value = existing?.value ?? (slug(en ?? '') || `option_${i + 1}`);
        while (used.has(value)) value = `${value}_${i + 1}`;
        used.add(value);
        return { value, labels: { en: en ?? '', de: de || en || '' } };
      });
  }

  function buildValidation(): FieldValidation {
    const v: FieldValidation = {};
    if (type === 'text' && maxLength !== '') v.maxLength = Number(maxLength);
    if (type === 'number') {
      if (min !== '') v.min = Number(min);
      if (max !== '') v.max = Number(max);
      if (integer) v.integer = true;
    }
    return v;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setBad(new Set());
    const common = {
      label: { en: labelEn, de: labelDe },
      required,
      sensitive,
      section: section.trim() === '' ? null : section.trim(),
      sortOrder: Number(sortOrder) || 0,
      options: isSelect ? buildOptions() : [],
      validation: buildValidation(),
    };
    const res: FieldResult = editing
      ? await updateFieldAction({ id: initial!.id, patch: common })
      : await createFieldAction({ entity: 'employee', key, type, ...common });
    setPending(false);
    if (!res.ok) {
      setBad(new Set(res.issues.map((i) => i.path.split('.')[0]!)));
      return setError(te((KNOWN.includes(res.code) ? res.code : 'generic') as never));
    }
    router.refresh();
    onDone();
  }

  const flag = (name: string) => (bad.has(name) ? t('checkValue') : undefined);

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl border border-line bg-paper/60 p-4 md:p-5"
      noValidate
    >
      <h2 className="text-lg font-semibold">{editing ? t('editTitle') : t('createTitle')}</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('labelEn')}
          required
          value={labelEn}
          error={flag('label')}
          onChange={(e) => {
            setLabelEn(e.target.value);
            if (!keyTouched) setKey(slug(e.target.value));
          }}
        />
        <Field
          label={t('labelDe')}
          required
          value={labelDe}
          error={flag('label')}
          onChange={(e) => setLabelDe(e.target.value)}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('key')}
          hint={editing ? t('keyLocked') : t('keyHint')}
          value={key}
          disabled={editing}
          error={flag('key')}
          onChange={(e) => {
            setKeyTouched(true);
            setKey(slug(e.target.value));
          }}
        />
        <div className="space-y-1.5">
          <label htmlFor="field-type" className="text-sm font-medium">
            {t('type')}
          </label>
          <select
            id="field-type"
            value={type}
            disabled={editing}
            onChange={(e) => setType(e.target.value as FieldType)}
            className="h-11 w-full rounded-lg border border-line bg-surface px-3 disabled:bg-paper disabled:text-muted"
          >
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {tt(x)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isSelect ? (
        <div className="space-y-1.5">
          <label htmlFor="field-options" className="text-sm font-medium">
            {t('options')}
          </label>
          <textarea
            id="field-options"
            rows={4}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5"
            aria-describedby="field-options-hint"
            aria-invalid={bad.has('options') || undefined}
          />
          <p id="field-options-hint" className="text-sm text-muted">
            {t('optionsHint')}
          </p>
          {bad.has('options') ? <p className="text-sm text-danger">{t('checkValue')}</p> : null}
        </div>
      ) : null}

      {type === 'text' ? (
        <div className="max-w-xs">
          <Field
            label={t('maxLength')}
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            className="tabular-nums"
            value={maxLength}
            error={flag('validation')}
            onChange={(e) => setMaxLength(e.target.value)}
          />
        </div>
      ) : null}
      {type === 'number' ? (
        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            label={t('min')}
            type="number"
            step="any"
            className="tabular-nums"
            value={min}
            error={flag('validation')}
            onChange={(e) => setMin(e.target.value)}
          />
          <Field
            label={t('max')}
            type="number"
            step="any"
            className="tabular-nums"
            value={max}
            error={flag('validation')}
            onChange={(e) => setMax(e.target.value)}
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 self-end">
            <input
              type="checkbox"
              className="size-4 accent-[var(--ink)]"
              checked={integer}
              onChange={(e) => setInteger(e.target.checked)}
            />
            {t('integer')}
          </label>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('section')}
          hint={t('sectionHint')}
          value={section}
          error={flag('section')}
          onChange={(e) => setSection(e.target.value)}
        />
        <Field
          label={t('order')}
          type="number"
          inputMode="numeric"
          className="tabular-nums"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            className="size-4 accent-[var(--ink)]"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          {t('required')}
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-2.5">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--ink)]"
            checked={sensitive}
            onChange={(e) => setSensitive(e.target.checked)}
          />
          <span>
            {t('sensitive')}
            <span className="block text-sm text-muted">{t('sensitiveHint')}</span>
          </span>
        </label>
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={pending}>
          {editing ? t('save') : t('create')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
