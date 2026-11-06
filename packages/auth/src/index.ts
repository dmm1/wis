export { createAuth } from './auth';
export type { Auth, AuthOptions } from './auth';
export { ac, statements, tenantRoles, tenantRoleNames, CREATOR_ROLE } from './permissions';
export type { TenantRoleName } from './permissions';
export { consoleMailer, createResendMailer } from './mailer';
export type { Mailer, MailMessage, ResendMailerOptions } from './mailer';
export { writeAudit } from '@wis/db';
export type { AuditEntry } from '@wis/db';
export { TenantError, TenantErrorCode, toTenantError } from './errors';
export {
  provisionTenant,
  provisionTenantSchema,
  setTenantStatus,
  canTransition,
  createPlatformAdmin,
} from './platform';
export type { PlatformDeps, ProvisionTenantInput, ProvisionTenantResult } from './platform';
export {
  createInvitedUser,
  getInvitationPreview,
  pendingInvitationsFor,
  InvitationError,
} from './invitations';
export type { InvitationPreview } from './invitations';
export {
  assertModuleEnabled,
  assertTenantActive,
  getTenantOverview,
  isModuleEnabled,
  BLOCKED_STATUSES,
} from './tenant';
export type { TenantOverview } from './tenant';
export {
  getTenantDetail,
  listTenants,
  resendInvitation,
  updateTenantEntitlements,
  updateEntitlementsSchema,
} from './platform-admin';
export type { TenantListItem } from './platform-admin';
export { registry } from '@wis/modules';
export { getBillingUsage, invitationTakesSeat, snapshotUsage } from './usage';
export type { BillingUsage } from './usage';
export { getEmployeeLogin, linkEmployeeToUser, listLinkableMembers } from './employee-link';
