import { z } from 'zod';

/** Entities owned by the platform core that accept custom fields. Modules add theirs via their manifest. */
export const CORE_EXTENSIBLE_ENTITIES = ['employee'] as const;

export const fieldTypes = ['text', 'number', 'date', 'boolean', 'select', 'multi_select'] as const;
export type FieldType = (typeof fieldTypes)[number];

export const SUPPORTED_LOCALES = ['en', 'de'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Every user-facing text exists in all supported languages. */
export const localizedText = z.object({
  en: z.string().trim().min(1).max(120),
  de: z.string().trim().min(1).max(120),
});
export type LocalizedText = z.infer<typeof localizedText>;

export const localize = (text: LocalizedText, locale: string): string =>
  (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? text[locale as SupportedLocale]
    : text.en;

const keyPattern = /^[a-z][a-z0-9_]{0,39}$/;

export const fieldOptionSchema = z.object({
  value: z.string().regex(keyPattern, 'lowercase letters, digits and underscores'),
  labels: localizedText,
});
export type FieldOption = z.infer<typeof fieldOptionSchema>;

const validationSchema = z
  .object({
    minLength: z.number().int().min(0).max(500),
    maxLength: z.number().int().min(1).max(500),
    pattern: z.string().min(1).max(100),
    min: z.number().finite(),
    max: z.number().finite(),
    integer: z.boolean(),
  })
  .partial()
  .strict();
export type FieldValidation = z.infer<typeof validationSchema>;

/** Nested quantifiers such as (a+)+ can make a regular expression take exponential time. */
const NESTED_QUANTIFIER = /([+*]|\{\d*,?\d*\})\)?[+*{]/;

export const fieldDefinitionInputSchema = z
  .object({
    entity: z.string().min(1).max(80),
    key: z
      .string()
      .regex(keyPattern, 'lowercase letters, digits and underscores, starting with a letter'),
    type: z.enum(fieldTypes),
    label: localizedText,
    required: z.boolean().default(false),
    /** Only roles with the "read-sensitive" permission can see or change values (e.g. bank details). */
    sensitive: z.boolean().default(false),
    section: z.string().trim().min(1).max(60).nullable().default(null),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    options: z.array(fieldOptionSchema).max(100).default([]),
    validation: validationSchema.default({}),
  })
  .superRefine((f, ctx) => {
    const add = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const isSelect = f.type === 'select' || f.type === 'multi_select';
    if (isSelect && f.options.length === 0)
      add(['options'], 'A select field needs at least one option');
    if (!isSelect && f.options.length > 0) add(['options'], 'Only select fields have options');
    if (new Set(f.options.map((o) => o.value)).size !== f.options.length)
      add(['options'], 'Option values must be unique');

    const v = f.validation;
    if (
      f.type !== 'text' &&
      (v.minLength !== undefined || v.maxLength !== undefined || v.pattern !== undefined)
    ) {
      add(['validation'], 'Length and pattern rules only apply to text fields');
    }
    if (
      f.type !== 'number' &&
      (v.min !== undefined || v.max !== undefined || v.integer !== undefined)
    ) {
      add(['validation'], 'Min, max and integer only apply to number fields');
    }
    if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength) {
      add(['validation', 'minLength'], 'Minimum length is larger than the maximum');
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max)
      add(['validation', 'min'], 'Minimum is larger than the maximum');
    if (v.pattern !== undefined) {
      if (NESTED_QUANTIFIER.test(v.pattern))
        add(['validation', 'pattern'], 'This pattern could be very slow. Simplify it');
      try {
        new RegExp(v.pattern);
      } catch {
        add(['validation', 'pattern'], 'Not a valid pattern');
      }
      if (v.maxLength === undefined || v.maxLength > 200) {
        add(
          ['validation', 'maxLength'],
          'Fields with a pattern need a maximum length of at most 200',
        );
      }
    }
  });

export type FieldDefinitionInput = z.input<typeof fieldDefinitionInputSchema>;
export type FieldDefinitionData = z.output<typeof fieldDefinitionInputSchema>;

/** A stored definition. `archivedAt` set = hidden from forms; its values stay in the data. */
export type FieldDefinition = FieldDefinitionData & { id: string; archivedAt: Date | null };

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Not a real date');

function fieldSchema(def: FieldDefinitionData): z.ZodType {
  const v = def.validation;
  switch (def.type) {
    case 'text': {
      let s = z.string().trim();
      if (v.minLength !== undefined) s = s.min(v.minLength);
      s = s.max(v.maxLength ?? 500);
      if (v.pattern !== undefined) s = s.regex(new RegExp(v.pattern));
      return s;
    }
    case 'number': {
      let n = z.number().finite();
      if (v.integer) n = n.int();
      if (v.min !== undefined) n = n.min(v.min);
      if (v.max !== undefined) n = n.max(v.max);
      return n;
    }
    case 'date':
      return isoDate;
    case 'boolean':
      return z.boolean();
    case 'select':
      return z.enum(def.options.map((o) => o.value) as [string, ...string[]]);
    case 'multi_select':
      return z
        .array(z.enum(def.options.map((o) => o.value) as [string, ...string[]]))
        .max(def.options.length)
        .refine((a) => new Set(a).size === a.length, 'Duplicate choices');
  }
}

export interface CustomDataOptions {
  /** Whether the caller may write sensitive fields. Without it they are not part of the schema. */
  canWriteSensitive: boolean;
}

/**
 * Builds the validator for a tenant's custom data on one entity. Strict: keys that are not an active,
 * writable field are rejected. `null` clears a value. Required fields must be present and non-empty.
 */
export function buildCustomDataSchema(defs: readonly FieldDefinition[], opts: CustomDataOptions) {
  const shape: Record<string, z.ZodType> = {};
  for (const def of defs) {
    if (def.archivedAt) continue;
    if (def.sensitive && !opts.canWriteSensitive) continue;
    const base = fieldSchema(def);
    shape[def.key] = def.required ? base : base.nullish();
  }
  return z.object(shape).strict();
}

/** Drops cleared (null/undefined) values so stored data stays compact. */
export function compactCustomData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
}

/** Keys of stored data the caller may not write (archived or sensitive without permission): they are preserved on update. */
export function protectedKeys(
  defs: readonly FieldDefinition[],
  opts: CustomDataOptions,
): Set<string> {
  const writable = new Set(
    defs.filter((d) => !d.archivedAt && (!d.sensitive || opts.canWriteSensitive)).map((d) => d.key),
  );
  return new Set(defs.map((d) => d.key).filter((k) => !writable.has(k)));
}

/** What the caller may see: active fields only; sensitive values only with the permission. */
export function visibleCustomData(
  defs: readonly FieldDefinition[],
  data: Record<string, unknown>,
  opts: { canReadSensitive: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    if (def.archivedAt) continue;
    if (def.sensitive && !opts.canReadSensitive) continue;
    if (def.key in data) out[def.key] = data[def.key];
  }
  return out;
}
