# ADR-0002: Environments and Neon branches

- Status: accepted
- Date: 2026-11-05

## Context

One Neon project (`wis - workforce in sync`, EU/Frankfurt, PostgreSQL 18). The dev database must keep working after go-live without risking production data.

## Decision

- `production` (default branch): live data only. Never used for local development or tests. Should be marked **protected** in the Neon console. Migrations reach it only through a deliberate release step.
- `development`: long-lived shared dev branch created from `production`; local `.env` points here.
- Short-lived branches (per PR or test run) are created from `development` and deleted afterwards. Schema-only branches for anything touching real customer data.
- Connection strings: pooled endpoint (`-pooler`) for the app, direct endpoint for migrations and pg-boss. Always `sslmode=verify-full`.
- Migrations are forward-only and applied in order: development → production.

## Consequences

- Safe to experiment on `development`; it can be reset from `production` if it drifts.
- Credentials per branch are separate `.env` values; production credentials are never stored on developer machines.
