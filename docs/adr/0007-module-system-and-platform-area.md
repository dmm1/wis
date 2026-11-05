# ADR-0007: Module registry, entitlement gating and the platform area

- Status: accepted
- Date: 2026-11-05

## Context

WIS is modular: each customer gets only the modules the platform enables for them, and a new module must not require edits all over the codebase.

## Decision

- **Manifest = contract.** `defineModule()` (`@wis/core`) validates a module manifest: id, version, permissions (`<module>:<action>`), `defaultRoleGrants` (system role → actions), `navigation` entries (path, message key, lucide icon name), i18n namespaces, extensible entities, emitted/consumed events. Invalid manifests (e.g. role granted an unknown action, bad paths) fail at startup.
- **Registry = what is compiled in.** `ModuleRegistry` (`@wis/core`) is instantiated once in `@wis/modules` (`packages/modules/registry`) with every module of this deployment. It validates duplicates and event providers, and derives permission statements, role grants and navigation. **Entitlements (`tenant_modules`) decide what a tenant may use**, never the registry.
- **Permissions derive from manifests.** `packages/auth/src/permissions.ts` builds the access-control statements and system roles from the registry (resource = module id). Adding a module does not touch auth code. Statically typed role names come from the core roles; module resources are string-keyed at runtime (documented trade-off to keep better-auth's role inference working).
- **Gating at three levels:**
  - navigation shows only modules enabled for the active workspace (and only while it is usable);
  - pages call `isModuleEnabled()` and answer 404 for disabled modules (indistinguishable from non-existent);
  - APIs use `assertModuleEnabled(db, tenantId, moduleId)`, which also checks tenant status; map `MODULE_NOT_ENABLED` to 404.
- **Platform area** (`/platform`, platform admins only; 404 for everyone else): customer list with search/status filter, create customer (`provisionTenant`), customer detail with status transitions (confirmation for suspend/offboard), seat limit (never below seats in use or reserved), modules, members, open invitations (resend), and the audit trail. Every server action re-checks the platform-admin role on the server and returns stable error codes; Next.js's built-in origin check protects against cross-site calls. Verified by calling the actions directly as anonymous, customer admin and platform admin.
- Disabling a module hides it; its data stays (re-enabling restores it). Hard deletion is an offboarding concern.

## Consequences

- A new module = new package under `packages/modules/<name>` + one line in `packages/modules/registry/src/index.ts` + messages namespace + (later) its routes. See AGENTS.md.
- Tenant-defined roles (dynamic access control) see all module resources; the service layer must still intersect with the tenant's enabled modules when evaluating permissions.
- The platform area is English/German and uses the same design tokens; it is the first consumer of the audit trail UI.
