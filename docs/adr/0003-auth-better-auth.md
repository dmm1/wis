# ADR-0003: Authentication and tenant model with better-auth

- Status: accepted
- Date: 2026-11-05

## Context

We need a platform-level operator role (global), customer tenants with their own roles, users who may belong to several tenants, 2FA/passkeys, and customers must not be able to create tenants themselves.

## Decision

- **better-auth** (`packages/auth`) with plugins: `admin` (platform operators), `organization` (tenant = organization; teams enabled; dynamic access control enabled), `twoFactor`, `passkey`.
- **Tenant = organization.** `allowUserToCreateOrganization: false`: only the platform (server-side `createOrganization` with `userId`) provisions tenants. The creator role is `customer-admin`.
- **System roles** (`packages/auth/src/permissions.ts`): `customer-admin`, `planner`, `team-lead`, `hr-payroll`, `employee`, `auditor`. Permissions say _what_ a role may do; row scoping (own team/location) is applied in the service layer via better-auth teams. Tenants can create their own roles (dynamic access control, `organization_role` table).
- **Multi-tenant users:** one account can be a member of many organizations; the active one is chosen per session (`setActiveOrganization`).
- **Auth tables are not tenant-scoped.** They live in `public`, are accessed on the owner connection by the auth layer only, have RLS enabled without policies and no grant to `wis_app` (migration `0002`). Tenant code cannot read them (tested).
- **Ids** are better-auth's default string ids; tenant tables use `tenant_id text` referencing `organization.id`.
- **Passwords:** min length 12. In `APP_ENV=production`: secure cookies and mandatory e-mail verification; `createAuth` refuses to start without a real `Mailer` (the console mailer prints links to logs).
- Rate limiting is enabled with database storage (works across instances).
- The Drizzle schema in `packages/db/src/schema/auth.ts` is generated: `cd packages/auth && npx auth@latest generate --config src/auth.cli.ts --output ../db/src/schema/auth.ts -y`, then `pnpm --filter @wis/db db:generate`. Add RLS-deny statements for any new auth table.

## Consequences

- Seat limits, last-admin protection and audit logging must be added via `organizationHooks` and our own services (roadmap step 2).
- Invitation e-mails are English-only for now; localisation (en/de) is a follow-up.
- Upgrading better-auth may change generated schema: regenerate and review the migration.
