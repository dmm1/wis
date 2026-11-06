export type PeopleErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'UNKNOWN_ENTITY'
  | 'DUPLICATE_KEY'
  | 'DUPLICATE_PERSONNEL_NUMBER'
  | 'TOO_MANY_FIELDS'
  | 'IMMUTABLE_FIELD'
  | 'OPTION_REMOVED'
  | 'SEAT_LIMIT_REACHED'
  | 'TENANT_NOT_ACTIVE';

/**
 * A field-level problem. `message` is English and for logs/API clients; user interfaces translate from
 * `code` (+ `origin`, `expected`, bounds) so every language gets a proper message.
 */
export interface Issue {
  path: string;
  message: string;
  code?: string;
  /** What the rule applies to for size rules: string (length), number, array. */
  origin?: string;
  expected?: string;
  minimum?: number;
  maximum?: number;
}

/** Converts a Zod issue into a translatable Issue. */
export function toIssue(i: {
  path: PropertyKey[];
  message: string;
  code: string;
  origin?: string;
  expected?: string;
  minimum?: unknown;
  maximum?: unknown;
}): Issue {
  const num = (v: unknown) =>
    typeof v === 'number' || typeof v === 'bigint' ? Number(v) : undefined;
  return {
    path: i.path.map(String).join('.'),
    message: i.message,
    code: i.code,
    ...(i.origin ? { origin: i.origin } : {}),
    ...(i.expected ? { expected: i.expected } : {}),
    ...(num(i.minimum) !== undefined ? { minimum: num(i.minimum)! } : {}),
    ...(num(i.maximum) !== undefined ? { maximum: num(i.maximum)! } : {}),
  };
}

export class PeopleError extends Error {
  constructor(
    readonly code: PeopleErrorCode,
    /** Field-level problems for forms. */
    readonly issues: Issue[] = [],
  ) {
    super(code);
    this.name = 'PeopleError';
  }
}

const SQLSTATE: Record<string, PeopleErrorCode> = {
  WS001: 'SEAT_LIMIT_REACHED',
  WS004: 'TENANT_NOT_ACTIVE',
};

/** Maps database errors (possibly wrapped by Drizzle in `cause`) to domain errors; rethrows the rest. */
export function mapDbError(e: unknown, uniqueMap: Record<string, PeopleErrorCode> = {}): never {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const err = cur as { code?: string; constraint?: string; cause?: unknown };
    if (err.code && SQLSTATE[err.code]) throw new PeopleError(SQLSTATE[err.code]!);
    if (err.code === '23505' && err.constraint && uniqueMap[err.constraint])
      throw new PeopleError(uniqueMap[err.constraint]!);
    cur = err.cause;
  }
  throw e;
}
