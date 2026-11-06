/** Stable machine-readable error codes (UI maps these to translated messages). */
export const TenantErrorCode = {
  SEAT_LIMIT_REACHED: 'SEAT_LIMIT_REACHED',
  TENANT_NOT_PROVISIONED: 'TENANT_NOT_PROVISIONED',
  TENANT_NOT_ACTIVE: 'TENANT_NOT_ACTIVE',
  LAST_ADMIN: 'LAST_ADMIN',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  MODULE_NOT_ENABLED: 'MODULE_NOT_ENABLED',
  UNKNOWN_MODULE: 'UNKNOWN_MODULE',
  SEATS_BELOW_USAGE: 'SEATS_BELOW_USAGE',
  INVITATION_NOT_PENDING: 'INVITATION_NOT_PENDING',
  EMPLOYEE_NOT_FOUND: 'EMPLOYEE_NOT_FOUND',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  ALREADY_LINKED: 'ALREADY_LINKED',
} as const;
export type TenantErrorCode = (typeof TenantErrorCode)[keyof typeof TenantErrorCode];

export class TenantError extends Error {
  constructor(
    readonly code: TenantErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TenantError';
  }
}

const SQLSTATE_TO_CODE: Record<string, TenantErrorCode> = {
  WS001: TenantErrorCode.SEAT_LIMIT_REACHED,
  WS002: TenantErrorCode.TENANT_NOT_PROVISIONED,
  WS004: TenantErrorCode.TENANT_NOT_ACTIVE,
};

/** Maps a database trigger error (possibly wrapped by Drizzle in `cause`) to a TenantError. */
export function toTenantError(e: unknown): TenantError | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: string }).code;
    if (code && SQLSTATE_TO_CODE[code]) return new TenantError(SQLSTATE_TO_CODE[code]);
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
