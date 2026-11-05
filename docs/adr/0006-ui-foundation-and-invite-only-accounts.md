# ADR-0006: UI foundation and invitation-only accounts

- Status: accepted
- Date: 2026-11-05

## Context

WIS is used on phones between shifts (PWA) and at desks by planners and admins. UX, accessibility and security are non-negotiable. Customers must not be able to create tenants, and anyone with an e-mail address must not be able to create an account.

## Decision

**Accounts**

- Open e-mail sign-up is disabled (`restrictSignUp` → `emailAndPassword.disableSignUp`). Accounts come from (a) an **invitation**: `createInvitedUser` requires the secret invitation id delivered by e-mail, which also proves control of the address, so the account is created verified; or (b) a **platform admin** via `pnpm --filter @wis/auth create-platform-admin <email>` (bootstrap, password shown once).
- The accept page (`/accept-invitation/[id]`) shows one of: sign-up (new person), sign-in (existing account), one-click join (signed in as invitee), wrong-account, expired, used, not found. After joining, the workspace becomes active.
- Password reset never reveals whether an account exists.

**Request-level tenant gate**

- `getAppContext()` resolves session, workspaces, active workspace, member role and tenant overview once per request. `TenantGate` renders a clear state (no workspace / choose workspace / workspace paused) instead of the page; suspended and offboarding tenants lose access immediately. `assertTenantActive()` (packages/auth) is the equivalent for API routes.

**Design system** (`apps/web/src/app/globals.css`)

- Tailwind CSS v4 with design tokens as CSS variables (light + dark via `prefers-color-scheme`). Neutral "ink and paper" chrome; the four **shift colours** (early amber, day azure, late rose, night indigo) are the only saturated colours because they carry meaning in schedules. Do not use them decoratively.
- Type: Bricolage Grotesque (headings) + IBM Plex Sans (UI/data, tabular numerals), self-hosted at build time by `next/font` (no runtime requests to Google; GDPR).
- Signature element: the **sync bars** (shift blocks gliding into alignment once, auth screens only); the same blocks show seat usage. Motion respects `prefers-reduced-motion`.
- Layout: left rail on desktop, bottom tab bar on mobile, workspace switcher in the header. Components: Radix primitives for menus (accessible by default), small in-house `Button`/`Field`/`Alert`.
- Copy rules: sentence case, active voice, same verb throughout a flow, errors say what to do. All strings in `messages/{en,de}.json`; German uses the formal "Sie".

## Consequences

- Every new screen must ship in English and German, work at 400 px, have visible focus and keyboard access, and use tokens instead of hard-coded colours.
- Passkey, 2FA and invitation flows are covered by integration tests (server) and by browser runs in Chromium (Playwright with a virtual WebAuthn authenticator and real TOTP codes). The browser scripts still need to move into the repo.
- A person with exactly one workspace gets it activated at session creation and never sees a chooser; people with several choose after each sign-in. People with no workspace see their open invitations with a join link.
- Admins are nudged (banner) to enable 2FA; hard enforcement is a follow-up.
