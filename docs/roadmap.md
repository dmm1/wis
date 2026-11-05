# Roadmap & progress

Single place to see where WIS stands. **Updated in the same change as the work** (see AGENTS.md). Last updated: 2026-11-05 (steps 1–3 done).

Legend: `[x]` done · `[~]` in progress · `[ ]` not started

## Now

Step 4 – custom fields engine, with `employee` as the first extensible entity (see [architecture §6](architecture.md)).

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
- [ ] Browser-level verification (Playwright): needs system libraries in the dev container (`sudo npx playwright install-deps`); UI is verified by build + HTTP flow only so far
- [ ] Enforce 2FA/passkey for customer-admins and platform admins (today: banner only)
- [ ] Use a Resend sending-only API key (current key has full access)
- [ ] Platform admin API/UI for provisioning, seats, status (step 3)
- [ ] Location scope for role assignments (when locations exist in work-schedule); role-management UI
- [ ] Usage snapshots + billing category counts (needs employees → step 4); update `enforce_seat_limit()` then
- [ ] Resend account: verify sending domain (EU region), set `RESEND_API_KEY` / `MAIL_FROM` (manual)
- [ ] Retention/purge job for audit log (GDPR)

### 3. Module registry + entitlements + platform admin UI — done

- [x] `ModuleRegistry` + extended manifest (role grants, navigation) in `@wis/core`; deployment registry in `@wis/modules`; `work-schedule` manifest (ADR-0007)
- [x] Permissions and system-role grants derived from manifests (no auth edits per module)
- [x] Entitlement gating: navigation, pages (404) and `assertModuleEnabled` for APIs
- [x] Platform area (`/platform`): customer list + search/status filter, create customer, detail (status, seats, modules, people, resend invitation, activity), en/de
- [x] Platform server actions verified: anonymous and customer-admin calls refused, validation and domain errors, audit entries
- [x] i18n parity test (en/de keys and placeholders)
- [ ] Browser-level UI verification (Playwright) — see step 2 follow-ups
- [ ] Platform: edit billing config (preset, prices) per customer; usage overview (needs step 4)
- [ ] Platform: sign-in / impersonation audit view; hard 2FA for platform admins

### 4. Custom fields engine

- [ ] `field_definitions`, `form_layouts`, `custom_data jsonb`
- [ ] Zod generated from definitions; indexes for filtered fields
- [ ] Employee as first extensible entity

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

See [adr/](adr/): 0001 RLS multi-tenancy · 0002 Environments and Neon branches · 0003 Auth with better-auth · 0004 Tenant controls in the database · 0005 Resend for e-mail · 0006 UI foundation and invite-only accounts · 0007 Module system and platform area.
