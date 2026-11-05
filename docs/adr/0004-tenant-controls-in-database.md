# ADR-0004: Seat limits, audit log and tenant status enforced in the database

- Status: accepted
- Date: 2026-11-05

## Context

Seat limits, tenant lifecycle and the audit trail are business-critical and must hold under concurrency and even if application code has a bug. Application-level checks alone are racy (two admins inviting at once) and bypassable.

## Decision

- **`tenant_entitlements`** (per tenant: `status`, `max_seats`, `billing` jsonb validated by `billingConfigSchema` in `@wis/core`, `trial_ends_at`) and **`tenant_modules`**. Written only by the platform (owner connection); tenants may read their own rows (RLS) and never write.
- **Seat limit = DB trigger** `enforce_seat_limit()` on `member` and `invitation` inserts. It locks the tenant's entitlement row (`FOR UPDATE`), so concurrent inserts serialise per tenant. Pending invitations reserve a seat. It also fails closed when a tenant has no entitlements (`WS002`) and blocks new members/invitations for `suspended`/`offboarding` tenants (`WS004`). Error codes: `WS001` seat limit, `WS002` not provisioned, `WS004` not active; `toTenantError()` maps them to stable codes (`SEAT_LIMIT_REACHED`, …).
  - A friendly pre-check in `organizationHooks.beforeCreateInvitation` returns the code without hitting the trigger in the normal case.
  - Today a seat is a member (login). When employees exist (roadmap step 4) the trigger function must count billable people per the tenant's billing config (architecture §4.3).
- **Audit log** `audit_log`: append-only. Triggers reject `UPDATE`, `DELETE` and `TRUNCATE` (`WS003`), also for the owner; only a retention job may delete by setting `wis.audit_purge = 'on'` in its transaction. `wis_app` has only `SELECT`/`INSERT`, restricted to its own tenant by RLS. Platform actions use `tenant_id IS NULL`. No FK to organization, so the trail outlives a tenant until purged.
  - Written for: tenant provisioning and status changes (same transaction), invitation created/accepted, member removed/role changed, and platform-admin actions (`/admin/*`), via a better-auth `after` hook.
- **Provisioning** (`provisionTenant`) is one transaction: organization + entitlements + modules + invitation for the first `customer-admin` + audit entry. The invitation e-mail is sent after commit; failure returns `emailSent: false` instead of rolling back.
- **Lifecycle** `trial → active → suspended → offboarding` via `setTenantStatus` (row-locked, validated transitions, audited).
- **Last admin:** better-auth already refuses to remove/demote the only owner (creator role); our `organizationHooks` repeat the check for `customer-admin` as defence in depth.
- Customers cannot create or delete tenants (`allowUserToCreateOrganization: false`, `disableOrganizationDeletion: true`).

## Consequences

- Limits cannot be exceeded by races or code bugs; tests prove it with concurrent inserts.
- The audit log can never be silently edited; GDPR erasure/retention needs the explicit purge path.
- Suspension currently blocks growth only. Blocking existing members' access per request is a follow-up (`assertTenantActive` in the app layer).
