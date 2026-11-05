import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';

const flatten = (obj: Record<string, unknown>, prefix = ''): Record<string, string> =>
  Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(acc, flatten(v as Record<string, unknown>, key));
    else acc[key] = String(v);
    return acc;
  }, {});

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\s*[,}]/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

describe('messages', () => {
  const e = flatten(en);
  const d = flatten(de);

  it('English and German define exactly the same keys', () => {
    expect(Object.keys(d).sort()).toEqual(Object.keys(e).sort());
  });

  it('uses the same ICU placeholders in both languages', () => {
    for (const key of Object.keys(e)) {
      expect(placeholders(d[key] ?? ''), key).toBe(placeholders(e[key] ?? ''));
    }
  });

  it('has no empty strings', () => {
    for (const [k, v] of [...Object.entries(e), ...Object.entries(d)])
      expect(v.trim(), k).not.toBe('');
  });
});
