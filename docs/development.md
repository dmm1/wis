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

## E-mail

Without `RESEND_API_KEY`, e-mails (invitations, verification, reset) are printed to the dev server console. To send real mail: verify a domain in Resend (EU region), create a sending-only API key, set `RESEND_API_KEY` and `MAIL_FROM` in `.env`. See ADR-0005.

## Database workflow

- Change schema in `packages/db/src/schema`, run `pnpm --filter @wis/db db:generate`, review the SQL, add RLS policy + `GRANT` for tenant tables, then `migrate`.
- Never edit an applied migration. Never point `.env` at `production`.
- DB integration tests create a throwaway schema and drop it afterwards; they need `.env`.

## Checks (same as CI)

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## PWA

The service worker is disabled in `next dev`. Test with `pnpm build && pnpm --filter @wis/web start`.
