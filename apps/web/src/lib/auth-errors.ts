/** Maps better-auth / domain error codes to message keys under the "Errors" namespace. */
const KNOWN = new Set([
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_PASSWORD',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'EMAIL_NOT_VERIFIED',
  'INVALID_TOKEN',
  'INVALID_CODE',
  'INVALID_BACKUP_CODE',
  'TOO_MANY_ATTEMPTS',
  'INVITATION_INVALID',
  'ACCOUNT_EXISTS',
  'SEAT_LIMIT_REACHED',
  'TENANT_NOT_ACTIVE',
  'USER_ALREADY_HAS_PASSKEY',
  'CHALLENGE_NOT_FOUND',
]);

export function errorKey(
  error: { code?: string | undefined; status?: number | undefined } | null | undefined,
): string {
  if (error?.status === 429) return 'TOO_MANY_ATTEMPTS';
  const code = error?.code;
  return code && KNOWN.has(code) ? code : 'generic';
}
