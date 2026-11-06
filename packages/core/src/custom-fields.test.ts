import { describe, expect, it } from 'vitest';
import {
  buildCustomDataSchema,
  compactCustomData,
  fieldDefinitionInputSchema,
  protectedKeys,
  visibleCustomData,
  type FieldDefinition,
  type FieldDefinitionInput,
} from './custom-fields';
import { defineModule } from './module';
import { ModuleRegistry } from './registry';

const label = (en: string, de = en) => ({ en, de });
let n = 0;
function def(
  input: Partial<FieldDefinitionInput> & Pick<FieldDefinitionInput, 'key' | 'type'>,
  archived = false,
): FieldDefinition {
  const parsed = fieldDefinitionInputSchema.parse({
    entity: 'employee',
    label: label(input.key),
    ...input,
  });
  return { ...parsed, id: `d${n++}`, archivedAt: archived ? new Date() : null };
}

describe('definition validation', () => {
  it('requires options for selects and forbids them elsewhere', () => {
    const base = { entity: 'employee', key: 'shirt', label: label('Shirt') };
    expect(fieldDefinitionInputSchema.safeParse({ ...base, type: 'select' }).success).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'select',
        options: [{ value: 's', labels: label('S') }],
      }).success,
    ).toBe(true);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'text',
        options: [{ value: 's', labels: label('S') }],
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'select',
        options: [
          { value: 's', labels: label('S') },
          { value: 's', labels: label('Again') },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires both languages and valid keys', () => {
    const base = { entity: 'employee', type: 'text' };
    expect(
      fieldDefinitionInputSchema.safeParse({ ...base, key: 'a', label: { en: 'A' } }).success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({ ...base, key: 'Bad Key', label: label('A') }).success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({ ...base, key: '1abc', label: label('A') }).success,
    ).toBe(false);
  });

  it('keeps rules consistent with the type and guards against slow patterns', () => {
    const base = { entity: 'employee', key: 'x', label: label('X') };
    expect(
      fieldDefinitionInputSchema.safeParse({ ...base, type: 'text', validation: { min: 1 } })
        .success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'number',
        validation: { maxLength: 4 },
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'number',
        validation: { min: 5, max: 1 },
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'text',
        validation: { pattern: '^[A-Z]{2}\\d+$', maxLength: 20 },
      }).success,
    ).toBe(true);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'text',
        validation: { pattern: '(a+)+$', maxLength: 20 },
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'text',
        validation: { pattern: '[', maxLength: 20 },
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionInputSchema.safeParse({
        ...base,
        type: 'text',
        validation: { pattern: '^a$' },
      }).success,
    ).toBe(false); // needs maxLength
  });
});

describe('buildCustomDataSchema', () => {
  const defs = [
    def({ key: 'shoe_size', type: 'number', validation: { min: 30, max: 55, integer: true } }),
    def({
      key: 'license',
      type: 'text',
      required: true,
      validation: { maxLength: 12, pattern: '^[A-Z0-9-]+$' },
    }),
    def({ key: 'started', type: 'date' }),
    def({ key: 'drives', type: 'boolean' }),
    def({
      key: 'size',
      type: 'select',
      options: [
        { value: 's', labels: label('S') },
        { value: 'm', labels: label('M') },
      ],
    }),
    def({
      key: 'langs',
      type: 'multi_select',
      options: [
        { value: 'de', labels: label('German') },
        { value: 'en', labels: label('English') },
      ],
    }),
    def({ key: 'iban', type: 'text', sensitive: true, validation: { maxLength: 34 } }),
    def({ key: 'old', type: 'text', validation: { maxLength: 10 } }, true),
  ];
  const schema = buildCustomDataSchema(defs, { canWriteSensitive: false });
  const ok = (data: unknown) => schema.safeParse(data).success;

  it('accepts valid data and treats optional fields as optional', () => {
    expect(
      ok({
        license: 'AB-12',
        shoe_size: 42,
        started: '2024-02-29',
        drives: true,
        size: 'm',
        langs: ['de'],
      }),
    ).toBe(true);
    expect(ok({ license: 'AB-12' })).toBe(true);
    expect(ok({ license: 'AB-12', shoe_size: null })).toBe(true); // null clears
  });

  it('enforces required fields and per-type rules', () => {
    expect(ok({})).toBe(false); // license required
    expect(ok({ license: '' })).toBe(false);
    expect(ok({ license: 'ab 12' })).toBe(false); // pattern
    expect(ok({ license: 'AB-12', shoe_size: 42.5 })).toBe(false); // integer
    expect(ok({ license: 'AB-12', shoe_size: 99 })).toBe(false); // max
    expect(ok({ license: 'AB-12', started: '2023-02-29' })).toBe(false); // not a real date
    expect(ok({ license: 'AB-12', started: '29.02.2024' })).toBe(false); // wrong format
    expect(ok({ license: 'AB-12', size: 'xl' })).toBe(false); // not an option
    expect(ok({ license: 'AB-12', langs: ['de', 'de'] })).toBe(false); // duplicates
    expect(ok({ license: 'AB-12', drives: 'yes' })).toBe(false);
  });

  it('rejects unknown, archived and (without permission) sensitive keys', () => {
    expect(ok({ license: 'AB-12', surprise: 1 })).toBe(false);
    expect(ok({ license: 'AB-12', old: 'x' })).toBe(false);
    expect(ok({ license: 'AB-12', iban: 'DE89' })).toBe(false);
    expect(
      buildCustomDataSchema(defs, { canWriteSensitive: true }).safeParse({
        license: 'AB-12',
        iban: 'DE89',
      }).success,
    ).toBe(true);
  });

  it('does not let prototype keys through', () => {
    expect(ok(JSON.parse('{"license":"AB-12","__proto__":{"x":1}}'))).toBe(false);
    expect(ok({ license: 'AB-12', constructor: 'x' })).toBe(false);
  });

  it('trims text and compacts cleared values', () => {
    const parsed = schema.parse({ license: '  AB-12  ', shoe_size: null });
    expect(parsed.license).toBe('AB-12');
    expect(compactCustomData(parsed)).toEqual({ license: 'AB-12' });
  });
});

describe('visibility and preserved keys', () => {
  const defs = [
    def({ key: 'nick', type: 'text', validation: { maxLength: 20 } }),
    def({ key: 'iban', type: 'text', sensitive: true, validation: { maxLength: 34 } }),
    def({ key: 'old', type: 'text', validation: { maxLength: 20 } }, true),
  ];
  const data = { nick: 'Ace', iban: 'DE89', old: 'legacy', orphan: 'no definition' };

  it('hides sensitive values without permission and never shows archived ones', () => {
    expect(visibleCustomData(defs, data, { canReadSensitive: false })).toEqual({ nick: 'Ace' });
    expect(visibleCustomData(defs, data, { canReadSensitive: true })).toEqual({
      nick: 'Ace',
      iban: 'DE89',
    });
  });

  it('lists the keys an update must preserve', () => {
    expect([...protectedKeys(defs, { canWriteSensitive: false })].sort()).toEqual(['iban', 'old']);
    expect([...protectedKeys(defs, { canWriteSensitive: true })]).toEqual(['old']);
  });
});

describe('extensible entities in the registry', () => {
  it('lists core and module entities', () => {
    const m = defineModule({
      id: 'work-schedule',
      version: '0.1.0',
      extensibleEntities: ['shift'],
    });
    expect(new ModuleRegistry([m]).extensibleEntityIds()).toEqual([
      'employee',
      'work-schedule.shift',
    ]);
  });
});
