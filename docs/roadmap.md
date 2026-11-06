# Roadmap & progress

Single place to see where WIS stands. **Updated in the same change as the work** (see AGENTS.md). Last updated: 2026-11-05 (steps 1–4 done).

Legend: `[x]` done · `[~]` in progress · `[ ]` not started

## Now

Step 5 – public API v1: API keys / OAuth2 client credentials, OpenAPI, webhooks via outbox, `external_refs` (see [architecture §7](architecture.md)).

## Foundation

### 1. Monorepo, CI, i18n, PWA shell — done

- [x] pnpm + Turborepo workspace, strict TypeScript (6.0.x), ESLint, Prettier, Vitest
- [x] CI workflow (format, lint, typecheck, test, build)
- [x] `apps/web`: Next.js 16, next-intl (`en`/`de`), security headers
- [x] PWA shell: manifest, service worker (Serwist), placeholder icons
- [x] `packages/core`: `defineModule()` manifest validation
- [x] `.env.example`, README, AGENTS.md/CLAUDE.md, docs + ADRs
- [ ] Real PWA icons / branding (placeholder squares today)
- [ ] Restrict service-worker caching before any authenticated data is served

### 2. Auth, tenancy, roles, audit — done (open follow-ups below)

- [x] Neon project, `production` + `development` branches (ADR-0002)
- [x] RLS foundation: `wis_app` role, `app_tenant_id()`, `withTenant()` + integration tests (ADR-0001)
- [x] better-auth setup (`admin` + `organization` + 2FA + passkey), auth tables owner-only with RLS-deny (ADR-0003)
- [x] System roles + permission statements; customers cannot self-create or delete tenants; auth route mounted in web
- [x] Multi-tenant membership + active-organization switching (API level, tested)
- [x] E-mail via Resend + localised (en/de) templates; production requires a real mailer (ADR-0005)
- [x] Tenant provisioning service (org + entitlements + modules + first-admin invitation + audit, atomic)
- [x] Tenant entitlements (`max_seats`, status, modules) + billing config schema (architecture §4.3)
- [x] Seat-cap enforcement as race-free DB trigger, tested with concurrent inserts (ADR-0004)
- [x] Append-only audit log (tenant + platform actions), immutable even for the owner
- [x] Tenant lifecycle transitions (trial → active → suspended → offboarding), last-admin safeguard
- [x] Roles: system roles + teams (better-auth) + tenant-defined roles enabled (dynamic access control)
- [x] Request-level enforcement: `TenantGate` / `assertTenantActive` block suspended and offboarding tenants (verified over HTTP)
- [x] Invitation-only accounts (open sign-up disabled) + platform-admin bootstrap script (ADR-0006)
- [x] Auth UI (en/de): sign-in, passkey, 2FA challenge, forgot/reset password, accept invitation, security settings (passkeys, 2FA setup with QR + backup codes, change password), app shell, workspace switcher/chooser, home with seat blocks
- [x] Browser-level verification (Playwright, Chromium): invitations, sign-up, passkey (virtual authenticator), 2FA with real TOTP + backup codes, workspace and language switching, platform admin flows, mobile (no horizontal scroll) and dark mode; 32 checks, 0 console errors.
- [x] Browser flows live in the repo as `@wis/e2e` (guarded seed, Playwright, cleanup); run with `pnpm --filter @wis/e2e e2e`
- [x] Last-used workspace is remembered (single-workspace users are activated automatically)
- [ ] Run `@wis/e2e` in CI (needs a Neon branch per run, secrets, Chromium)
- [ ] Enforce 2FA/passkey for customer-admins and platform admins (today: banner only)
- [ ] Use a Resend sending-only API key (current key has full access)
- [ ] Platform admin API/UI for provisioning, seats, status (step 3)
- [ ] Location scope for role assignments (when locations exist in work-schedule); role-management UI
- [x] Billing category counts and `enforce_seat_limit()` over billable people (step 4)
- [ ] Resend account: verify sending domain (EU region), set `RESEND_API_KEY` / `MAIL_FROM` (manual)
- [ ] Retention/purge job for audit log (GDPR)

### 3. Module registry + entitlements + platform admin UI — done

- [x] `ModuleRegistry` + extended manifest (role grants, navigation) in `@wis/core`; deployment registry in `@wis/modules`; `work-schedule` manifest (ADR-0007)
- [x] Permissions and system-role grants derived from manifests (no auth edits per module)
- [x] Entitlement gating: navigation, pages (404) and `assertModuleEnabled` for APIs
- [x] Platform area (`/platform`): customer list + search/status filter, create customer, detail (status, seats, modules, people, resend invitation, activity), en/de
- [x] Platform server actions verified: anonymous and customer-admin calls refused, validation and domain errors, audit entries
- [x] i18n parity test (en/de keys and placeholders)
- [ ] Platform: edit billing config (preset, prices) per customer; usage overview (needs step 4)
- [ ] Platform: sign-in / impersonation audit view; hard 2FA for platform admins

### 4. Custom fields engine — done

- [x] `field_definition` (per tenant and entity), `employee.custom_data jsonb` + GIN index, RLS (ADR-0008)
- [x] Strict Zod validation generated from definitions; sensitive fields; archived values preserved; translatable issue codes
- [x] `employee` as the first extensible entity: `@wis/people` services (fields + employees), permissions via better-auth (dynamic roles honoured), audit without values
- [x] Employee ↔ login linking; billable headcount counted once per person; `enforce_seat_limit()` now counts billable people (per preset); race-free also for employees
- [x] `usage_snapshots` + `snapshotUsage` (daily counts per category)
- [x] UI (en/de): employees list/create/edit generated from the tenant's fields, login panel, custom fields admin; browser flow F in `@wis/e2e`
- [ ] Per-role form layouts (today: sensitive vs. not, sections and order)
- [ ] Expression indexes for frequently filtered custom fields
- [ ] Employee erasure/anonymisation (GDPR) as a platform operation; no delete for tenant code today
- [ ] Run `snapshotUsage` daily (scheduled job, step 5 job infrastructure)
- [ ] Invite an employee to get a login from the employee record; CSV import of employees

### 5. Public API v1 skeleton

- [ ] API keys / OAuth2 client credentials, scopes = module permissions
- [ ] OpenAPI generated from Zod, idempotency keys, cursor pagination
- [ ] Transactional outbox + signed webhooks with delivery log
- [ ] `external_refs`

### 6. Module: work-schedule

- [ ] To be planned after step 5 (rules engine for AT/DE labour law, shifts, swaps, PWA offline view)

## Later

- Connector framework (CSV, SCIM, payroll export e.g. BMD/DATEV)
- Web Push notifications
- SSO (SAML/OIDC)
- Production hosting, backups/restore drill, monitoring
- WIS's own subscription billing (consumes usage snapshots)

## Open questions

- Production app hosting target (Neon DB is decided).
- First concrete integrations customers will ask for.
- Work-schedule rules engine scope for v1.
- Mark Neon `production` branch as protected (manual, in console).

## Decisions

See [adr/](adr/): 0001 RLS multi-tenancy · 0002 Environments and Neon branches · 0003 Auth with better-auth · 0004 Tenant controls in the database · 0005 Resend for e-mail · 0006 UI foundation and invite-only accounts · 0007 Module system and platform area · 0008 Custom fields, employees and billable headcount.
