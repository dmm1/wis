# WIS – Workforce, in sync: Architecture (v0.1, draft)

## 1. Goals & non-negotiables

- Multi-tenant SaaS, modular, per-tenant configurable (modules, roles, fields, layouts).
- Scales to tens of thousands of users; EU hosting; GDPR/DSGVO by design.
- Security, UX and accessibility are not up for negotiation.
- i18n from day one: `en` (default) and `de`.
- Installable PWA for employees.
- **API-first / integration-ready**: every capability is reachable through a stable, versioned, documented API so HR, payroll and billing systems can connect.

## 2. Stack

| Concern       | Choice                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| Language      | TypeScript (strict), pnpm + Turborepo monorepo                                            |
| Web/PWA       | Next.js (App Router), Serwist (service worker), next-intl                                 |
| API           | Hono (or tRPC internally + Hono for the public REST API), OpenAPI generated from Zod      |
| DB            | PostgreSQL, Drizzle/Kysely, Row Level Security                                            |
| Auth          | better-auth: `admin` (platform), `organization` (tenant + roles), `api-key`, passkey, 2FA |
| Jobs / events | pg-boss (Postgres-backed queue) + transactional outbox; no Redis in v1                    |

## 3. Layering (keeps the API honest)

```
apps/web            UI + PWA
apps/api            HTTP surface (public REST /api/v1, webhooks, internal RPC)
packages/core       tenancy, auth glue, module registry, custom fields, events, audit
packages/modules/*  work-schedule, ... (each: schema, services, permissions, manifest, ui)
packages/connectors/*  integrations (hr, payroll, billing, ...)
```

Rule: UI and public API both call the **same application services**. No business logic in route handlers or components.

## 4. Multi-tenancy

- Shared schema, `tenant_id` on every tenant row, enforced by RLS (`SET LOCAL app.tenant_id` per request/transaction).
- better-auth `admin` = platform operators only. `organization` = customer; roles carry per-module permissions (`schedule:read`, `schedule:publish`, ...).
- `tenant_modules` = entitlements. Disabled module ⇒ not routable, no nav, API returns 404.

### 4.1 Tenant onboarding & users

1. Platform admin creates tenant (better-auth `organization`; implemented as `provisionTenant`, see ADR-0004) and sets entitlements (`max_seats`, modules) → invites first customer admin (single-use, expiring invitation; 2FA/passkey enforced for admins).
2. Customer admin logs in, creates/invites users within the seat limit.

- **User ≠ Employee.** Employee = schedulable HR-style record (custom fields live here). User = login, optionally linked to an employee. Employees without login are supported (kiosk, imports).
- **Seat limit** counts billable people per the tenant's billing config (see 4.3) + pending invitations. Enforced in the service layer inside a transaction that locks the tenant row (no race). Warnings at 80%/100%. Deactivation frees the seat, history is kept.
- **Tenant lifecycle:** `trial → active → suspended → offboarding` (export, then deletion).
- A user account can belong to several tenants (e.g. consultants); the active tenant is selected per session (tenant switcher). Seats are counted per tenant.
- A tenant always keeps ≥ 1 admin; explicit ownership transfer.
- Platform support impersonation: time-limited, reason required, audited, visible to tenant.

### 4.3 Metering & billing model

- **One billable person per human.** Every active person falls into exactly one category: `employee_with_login` (employee linked to a user), `employee_no_login`, `user_only` (login without employee record). `employee.user_id` is unique, so no double counting.
- **Per-tenant billing config:** which categories are billable, unit price per category, optional cap per category/total. Presets: per user (`with_login` + `user_only`), per employee (`with_login` + `no_login`), both (all three, each person once).
- **Live view** of category counts (source for seat-cap enforcement); **daily `usage_snapshots`** per tenant/category (source for billing). Charging basis (period end, peak, daily average) is config, not schema.
- **"Active"** has a single shared definition: user not deactivated; employee status active and employment dates cover the day.
- Metering is decoupled from invoicing: an external billing tool (e.g. Stripe) only consumes snapshots. WIS does not become a billing system.

### 4.2 Roles

- System roles: customer-admin, planner, team-lead, hr-payroll, employee, read-only/auditor. Tenants can clone and customize (permissions are data; only permissions of enabled modules are offered).
- **Scoped assignments:** `(user, role, scope)` with scope = tenant | location | team. Team leads see only their team.
- Platform roles (better-auth `admin`): super-admin, support, read-only.

## 5. Module system

Each module exports a manifest: `id`, permissions, nav entries, routes, migrations, extension points (entities that accept custom fields), emitted/consumed events, i18n namespaces. Modules interact only via events and public service interfaces, never via foreign tables.

## 6. Per-tenant customization

> Implemented in step 4: see [ADR-0008](adr/0008-custom-fields-and-employees.md). Differences from the sketch below: no per-role `form_layouts` yet (sections, order and a `sensitive` flag instead); definitions are archived, never deleted.

- Typed core columns + `custom_data jsonb` on extensible entities.
- `field_definitions` (tenant, entity, key, type, validation, i18n labels, role visibility), `form_layouts` (tenant, entity, role).
- Validation via Zod generated from definitions; GIN/expression indexes for filtered fields.
- Initial types: text, number, date, boolean, select, multi-select. Add more only on demand.
- Custom fields are part of the public API schema and webhook payloads (see §7).

## 7. Integrations (first-class from day one)

**Principle:** the public API is a product. Our own UI is just its first consumer.

### Inbound API

- Versioned REST: `/api/v1/...`, OpenAPI 3.1 generated from the same Zod schemas as the services; SDK generation possible.
- Auth: tenant-scoped **API keys** and **OAuth2 client credentials**; scopes map 1:1 to module permissions (`schedule:read`, ...). Per-key rate limits, expiry, rotation, last-used audit.
- Conventions: cursor pagination, `updated_since` filter for incremental sync, `Idempotency-Key` on writes, ETag/`If-Match` for optimistic concurrency, RFC 9457 problem+json errors, stable UUIDv7 ids.
- Compatibility policy: additive changes only within a version; deprecation window ≥ 12 months; contract tests in CI guard the public schema.

### Outbound events

- Domain events written to a **transactional outbox**, then delivered as **webhooks**: per-tenant subscriptions, HMAC-signed, retries with exponential backoff, delivery log + manual replay, versioned event schemas (`schedule.shift.published.v1`).
- Same event stream feeds internal consumers (notifications, audit, connectors).

### Mapping to external systems

- `external_refs` (tenant, entity_type, entity_id, system, external_id, synced_at) so one employee can have ids in HR, payroll and billing.
- Per-tenant field mapping config (can target custom fields).

### Connector framework

- Connectors are a module type: `connectors/<name>` with auth config, mapping, sync jobs (pull/push), run history and error surface in the admin UI.
- Credentials stored with envelope encryption (KMS in an EU region); never returned by the API.
- Jobs run on pg-boss with per-tenant concurrency limits so one noisy integration cannot starve others.
- Likely early targets (to validate with customers): CSV import/export, SCIM 2.0 user provisioning from HR/IdP, payroll export (e.g. BMD, DATEV), generic webhook/REST.

## 8. i18n

- Locales `en` (default), `de`; ICU messages via next-intl; locale resolved per user → tenant → default.
- All user-facing strings incl. custom field labels and notification templates are translatable; backend errors carry codes, not prose.
- Dates/times: store UTC + IANA tz per location; format by locale; handle DST and shifts across midnight explicitly.

## 9. PWA

- Installable, app-shell caching, offline read of own upcoming shifts, background sync for queued actions (e.g. shift swap request), Web Push (VAPID) with per-user subscriptions and notification preferences.
- API must support cookie sessions (web/PWA) and tokens (integrations) side by side.

## 10. Security & compliance

- RLS as defence in depth behind app-level permission checks; permission checks live in services.
- Passkeys + TOTP, session management, CSP, rate limiting, secure headers, dependency and secret scanning in CI.
- Append-only audit log (who/what/when/tenant, incl. API-key actors).
- PII encryption for sensitive fields, data export & erasure flows, retention policies, EU-only hosting and subprocessors.

## 11. Open questions

1. ~~Hosting / Postgres~~ Decided: local dev machine for now; Neon Postgres (EU region, Frankfurt). Pooled endpoint for the app (RLS via `SET LOCAL` inside transactions), direct endpoint for pg-boss (LISTEN/NOTIFY, advisory locks). Neon branches for dev/PR databases. Production app hosting still open.
2. First concrete integrations customers will ask for (drives connector priority).
3. Billing/subscription for WIS itself (Stripe vs. invoicing) – needed before first paying tenant.
4. Work-schedule rules engine scope for AT/DE labour law in v1.

## 12. Proposed build order

1. Monorepo, CI, lint/type/test baseline, i18n + PWA shell.
2. Auth + tenancy + RLS + roles/permissions + audit log.
3. Module registry + entitlements + platform admin UI.
4. Custom fields engine (employee as first extensible entity).
5. Public API v1 skeleton: API keys, OpenAPI, webhooks/outbox.
6. Module: work-schedule.
