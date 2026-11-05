# ADR-0001: Shared schema with Postgres Row Level Security

- Status: accepted
- Date: 2026-11-05

## Context

WIS must serve tens of thousands of users across many customers (tenants) with strict isolation. Schema-per-tenant or database-per-tenant make migrations and connection pooling painful at scale.

## Decision

One shared schema; every tenant row carries `tenant_id`. Isolation is enforced by Postgres RLS, not only by application code.

- Neon's connection owner (`neondb_owner`) has `BYPASSRLS`, so policies would never apply to it. Runtime queries therefore run in a transaction that executes `SET LOCAL ROLE wis_app` (a `NOLOGIN`, `NOBYPASSRLS` role) and `set_config('app.tenant_id', …, true)`. This is `withTenant()` in `packages/db`.
- `SET LOCAL` is transaction-scoped, so it is safe behind Neon's PgBouncer (transaction pooling).
- `app_tenant_id()` returns NULL when unset, so policies fail closed.
- No default privileges: each migration grants to `wis_app` per table. Auth internals (users, sessions, …) get no grant and are accessed only by the auth layer on the owner connection.

## Consequences

- Application bugs cannot leak across tenants through tenant tables (second line of defence behind permission checks).
- Every tenant table needs a policy + grant in its migration; a missing policy means no access (fail closed), a forgotten `ENABLE ROW LEVEL SECURITY` means no isolation — covered by tests/review.
- Cross-tenant operations (platform admin, billing snapshots, jobs) must use explicit, audited code paths on the owner connection.
- A user may belong to several tenants (e.g. consultants); the active tenant is chosen per session (tenant switcher).
