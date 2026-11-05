# WIS – Workforce, in sync

Modular, multi-tenant workforce SaaS. See [docs/architecture.md](docs/architecture.md).

## Requirements

- Node 24 (`.nvmrc`), pnpm 12

## Commands

```bash
pnpm install
pnpm dev          # all apps (web on http://localhost:3000)
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format
```

## Layout

- `apps/web` – Next.js UI + PWA (next-intl: `en` default, `de`)
- `packages/core` – module manifest, shared domain primitives
- `packages/modules/*` – feature modules (work-schedule next)
- `packages/connectors/*` – integrations (later)

The service worker is disabled in `next dev`; test the PWA with `pnpm build && pnpm --filter @wis/web start`.
