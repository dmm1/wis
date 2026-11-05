# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. `CLAUDE.md` points here — keep this file the single source of truth.

## Product

**WIS – Workforce, in sync**: a modular, multi-tenant workforce SaaS (competitor to bitfactory.at). Tenants (customers) enable modules, define their own roles and custom fields, and connect external systems (HR, payroll, billing) via API. First module: `work-schedule`.

Read before non-trivial work: [docs/architecture.md](docs/architecture.md) and [docs/adr/](docs/adr/).

## Commands

```bash
pnpm install
pnpm dev                          # web on http://localhost:3000
pnpm lint | typecheck | test | build
pnpm format                       # Prettier (CI runs format:check)
pnpm --filter @wis/db migrate     # apply DB migrations (direct Neon endpoint)
pnpm --filter @wis/db db:generate # generate a migration from schema changes
```

Run `pnpm lint && pnpm typecheck && pnpm test` before declaring work done. Node 24, pnpm 12.

## Layout

- `apps/web` – Next.js (App Router) UI + PWA. i18n via next-intl (`en` default, `de`).
- `packages/core` – module manifest (`defineModule`), shared primitives.
- `packages/db` – Drizzle, migrations, `withTenant()` (RLS context), generated auth schema.
- `packages/auth` – better-auth config (`createAuth`), roles/permissions, mailer interface.
- `packages/modules/registry` (`@wis/modules`) – the modules compiled into this deployment; `packages/modules/<name>` – feature modules. `packages/connectors/*` – integrations.
- Platform area: `apps/web/src/app/[locale]/(app)/platform` (platform admins only).

## Hard rules

1. **Tenant isolation is enforced by Postgres RLS.** Tenant data is only accessed through `withTenant(db, tenantId, fn)`, which runs as role `wis_app` (no BYPASSRLS). Never query tenant tables with the plain owner connection. Every tenant table: `tenant_id`, `ENABLE ROW LEVEL SECURITY`, policy on `app_tenant_id()`, explicit `GRANT` to `wis_app`. No default privileges. See ADR-0001.
2. **API-first.** UI and public API call the same application services. No business logic in route handlers or components.
3. **Modules** talk to each other via events and public service interfaces, never via each other's tables.
4. **i18n:** no hard-coded user-facing strings; add keys to `apps/web/messages/en.json` and `de.json` together. Backend errors carry codes, not prose.
5. **Auth tables are owner-only.** Only `packages/auth` touches them; tenant code never gets a grant. `createAuth` requires a real `Mailer` in production (Resend, ADR-0005).
6. **Security:** validate all input with Zod; check permissions in services (RLS is the second line of defence); never log secrets or personal data; audit-log mutating actions.
7. **Migrations are forward-only and committed.** Never edit an applied migration; add a new one. Tests that touch the DB use throwaway schemas and clean up.
8. **Seat/billing:** one billable person per human (see architecture §4.3). Never double count. The seat limit is enforced by the DB trigger `enforce_seat_limit()` (ADR-0004): when employees are added, update that function instead of adding app-only checks.
   The audit log is append-only; write via `writeAudit()`, inside the same transaction as the change when possible. Domain errors use stable codes (`TenantErrorCode`).
9. **Track progress.** Update [docs/roadmap.md](docs/roadmap.md) in the same change: tick finished items, add newly discovered tasks, move "Now". Report status from that file, not from memory.
10. **Docs are part of the change.** Update docs in the same change; record significant decisions as an ADR (`docs/adr/NNNN-title.md`, copy `0000-template.md`).

## Adding a module (ADR-0007)

1. `packages/modules/<name>`: `defineModule()` manifest (permissions, `defaultRoleGrants`, `navigation`, events). Domain code, schema and services live in the module; no cross-module table access.
2. Register it in `packages/modules/registry/src/index.ts`.
3. Messages: add a top-level namespace named after the module id (`nav.title`, …) to both `en.json` and `de.json`, plus `Home.modules.<id>` (display name).
4. Pages under `apps/web/src/app/[locale]/(app)/<path>`: wrap in `TenantGate`, call `isModuleEnabled(ctx.tenant, '<id>')` → `notFound()`. APIs: `assertModuleEnabled()`.
5. Tenant tables follow hard rule 1 (RLS + grant). Update the roadmap and add tests (permissions come for free from the manifest).

## UI conventions (ADR-0006)

- Use design tokens from `globals.css` (`bg-paper`, `text-muted`, `border-line`, …); never hard-code colours. Shift colours (`early/day/late/night`) are reserved for schedule meaning and the brand mark.
- Every screen: English **and** German, usable at 400 px, keyboard-accessible with visible focus, errors announced (`Alert`), 44 px touch targets. Tenant pages go through `TenantGate`.
- Copy: sentence case, active voice, specific button labels ("Save password", not "Submit"), errors say what to do.
- Auth/tenant calls from the browser use `authClient`; server pages use `getAppContext()`. Map error codes via `errorKey()` + `Errors.*` messages.

## Environments & secrets

- Neon project `wis - workforce in sync` (EU, Frankfurt). Branch `production` is **off-limits for development and tests**; local work uses branch `development`. See ADR-0002 and [docs/development.md](docs/development.md).
- Secrets live in `.env.local` or `.env` at the repo root (both git-ignored; `.env.local` wins). Never print, log, commit or paste secret values. `.env.example` documents the keys.
- Do not run destructive Neon operations (delete/reset/restore) without explicit user approval.

## Working agreements

- **Do not `git commit` or push.** The maintainer commits themselves. Leave changes in the working tree and summarise them.
- Prefer small, verifiable steps; show evidence (test output) rather than claims.
- Dependency choices: pin compatible versions (e.g. TypeScript is held at 6.0.x until typescript-eslint supports 7). Do not approve new install scripts without asking (`allowBuilds` in `pnpm-workspace.yaml`).
