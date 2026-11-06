/** The part of a validation issue a UI needs to pick a translated message. */
export interface IssueLike {
  path?: string;
  message?: string;
  code?: string;
  origin?: string;
  expected?: string;
  minimum?: number;
  maximum?: number;
}

export type ValidationKey =
  | 'required'
  | 'tooLong'
  | 'tooShort'
  | 'tooBig'
  | 'tooSmall'
  | 'format'
  | 'choice'
  | 'wholeNumber'
  | 'number'
  | 'date'
  | 'endBeforeStart'
  | 'invalid';

/** Chooses the message key (and its numbers) for a server issue. The text itself lives in messages/*.json. */
export function issueKey(i: IssueLike): {
  key: ValidationKey;
  values: { min?: number; max?: number };
} {
  const values = {
    ...(i.minimum !== undefined ? { min: i.minimum } : {}),
    ...(i.maximum !== undefined ? { max: i.maximum } : {}),
  };
  const out = (key: ValidationKey) => ({ key, values });
  switch (i.code) {
    case 'too_big':
      return out(i.origin === 'string' ? 'tooLong' : i.origin === 'number' ? 'tooBig' : 'invalid');
    case 'too_small':
      if (i.origin === 'string' && (i.minimum ?? 0) <= 1) return out('required');
      return out(
        i.origin === 'string' ? 'tooShort' : i.origin === 'number' ? 'tooSmall' : 'invalid',
      );
    case 'invalid_format':
      return out('format');
    case 'invalid_value':
      return out('choice');
    case 'invalid_type':
      if (i.expected === 'int' || i.expected === 'integer') return out('wholeNumber');
      if (i.expected === 'number') return out('number');
      return out('required');
    case 'custom':
      if (/date/i.test(i.message ?? '') && /end/i.test(i.message ?? ''))
        return out('endBeforeStart');
      if (/real date/i.test(i.message ?? '')) return out('date');
      return out('invalid');
    default:
      return out('invalid');
  }
}
