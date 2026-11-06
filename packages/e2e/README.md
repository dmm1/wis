# @wis/e2e – browser tests

Flows: A join workspaces · F custom fields and employees · B sign-up from invitation · C passkey and 2FA · D platform admin · E mobile and dark mode.

Drives the **built** web app in Chromium (Playwright): invitations and sign-up, passkeys (virtual WebAuthn authenticator), two-step verification with real TOTP codes and backup codes, workspace and language switching, the platform admin flows, mobile (no horizontal scroll) and dark mode. It also fails on any browser console error.

## Run

```bash
pnpm build                                           # the suite tests the production build
pnpm --filter @wis/e2e exec playwright install chromium   # once
pnpm --filter @wis/e2e e2e                           # all flows (≈ 2 min)
pnpm --filter @wis/e2e e2e A C                       # only some flows
pnpm --filter @wis/e2e cleanup                       # remove test data after an interrupted run
```

Linux needs the browser's system libraries once: `sudo npx playwright install-deps chromium`.

## What it does

1. Removes leftovers, then seeds a platform admin and three customers (`@wis.test` accounts).
2. Starts `next start` on the port of `BETTER_AUTH_URL` with `MAIL_TRANSPORT=console` (no real e-mail).
3. Runs flows A–E, writes screenshots to `artifacts/` (git-ignored) and prints PASS/FAIL per check.
4. Always cleans up and stops the server.

## Safety

- **Never point it at real data.** It refuses to run if any user other than `@wis.test` exists. Use the Neon `development` branch (see ADR-0002).
- Cleanup only deletes `@wis.test` users, `smoke-*` customers, the customer created in flow D, and audit rows tied to them.
- Sign-in is rate limited (3 per 10 s per path); the flows pause between logins on purpose.
