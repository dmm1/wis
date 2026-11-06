# Development guide

## Setup

1. Node 24 and pnpm 12 (`.nvmrc`, `packageManager`).
2. `pnpm install`
3. `cp .env.example .env.local` (or `.env`) and fill it in; `.env.local` wins. Use the **development** Neon branch endpoints (pooled for `DATABASE_URL`, direct for `DATABASE_URL_UNPOOLED`), `sslmode=verify-full`. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
   `APP_ENV` stays `local` for development. The single `.env` at the repo root is used by all packages (Next.js loads it via `next.config.ts`). Never `source` it in a shell: values contain `&`.
4. `pnpm --filter @wis/db migrate`
5. `pnpm dev` → http://localhost:3000

## First platform admin

Open sign-up is disabled, so create the first operator from the command line (password is generated and shown once unless `PLATFORM_ADMIN_PASSWORD` is set):

```bash
pnpm --filter @wis/auth create-platform-admin you@example.com "Your Name"
```

Then sign in, and add a passkey and 2FA under Security.

## GitHub Codespaces and other proxies

Server Actions, sign-in and passkeys all check that the browser's address matches the app's configured URL. Open the app in one of two ways:

- **`http://localhost:3000`**: use the Ports panel's local forwarding and keep `APP_URL` / `BETTER_AUTH_URL` at `http://localhost:3000`.
- **The forwarded URL** (`https://<codespace-name>-3000.app.github.dev`): set both `APP_URL` and `BETTER_AUTH_URL` to exactly that address and restart `pnpm dev`. The app then allows it for Server Actions (`next.config.ts` derives the allowed host from `BETTER_AUTH_URL`), accepts it as a trusted auth origin, and uses its host for passkeys.

In production builds the allowed host is fixed at **build time**, so set `BETTER_AUTH_URL` (and `ALLOWED_ORIGINS` if needed) when running `next build`.

If you see "Invalid Server Actions request", the address in the browser and `BETTER_AUTH_URL` differ. The browser tests (`@wis/e2e`) always use `http://localhost:3000` regardless of your `.env.local`.

## E-mail

Without `RESEND_API_KEY`, e-mails (invitations, verification, reset) are printed to the dev server console. To send real mail: verify a domain in Resend (EU region), create a sending-only API key, set `RESEND_API_KEY` and `MAIL_FROM` in `.env`. See ADR-0005.

## Database workflow

- Change schema in `packages/db/src/schema`, run `pnpm --filter @wis/db db:generate`, review the SQL, add RLS policy + `GRANT` for tenant tables, then `migrate`.
- Never edit an applied migration. Never point `.env` at `production`.
- DB integration tests create a throwaway schema and drop it afterwards; they need `.env`.

## Checks (same as CI)

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Browser tests

`pnpm build && pnpm --filter @wis/e2e e2e` drives the built app in Chromium (see [packages/e2e/README.md](../packages/e2e/README.md)). It only runs against a database without real users and removes its own test data.

## PWA

The service worker is disabled in `next dev`. Test with `pnpm build && pnpm --filter @wis/web start`.
