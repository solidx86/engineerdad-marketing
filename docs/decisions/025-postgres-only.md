# ADR-025: Postgres-only substrate

**Date:** 2026-05-26
**Status:** Accepted
**Supersedes:** Storage substrate sections of ADR-008, ADR-021, ADR-022
**Tracker:** E-034

## Context

For most of the project's history the repo ran two persistence substrates
side by side: Postgres (via Drizzle) for the 8 store entities and the
`orchestrator.step_results` claim-check table, and SQLite (via `node:sqlite`)
for the orchestrator's run state and the analytics signals/bandit tables.

The split was rational at each migration step (store moved off Notion;
step_results needed JSONB), but the dual-substrate surface had become its
own tax:
- Two connection idioms in test setup (temp SQLite file vs. PG truncate).
- Two migration tools (`pnpm store:push` / `pnpm orchestrator:push` vs.
  `applyMigrations()` in `getDb()`).
- Two type conventions (`TEXT`/`INTEGER` vs. `JSONB`/`TIMESTAMPTZ`).
- Vitest config carrying `external: ["node:sqlite", /^node:/]` only to
  serve the SQLite branch.

## Decision

One Postgres database (`engineerdad`), three schemas:
- `public` — the 8 store entities (existing).
- `orchestrator` — `runs`, `run_steps`, `step_results`.
- `analytics` — `meta_insights`, `creatives`, `events`, `angle_tags`,
  `creative_signals`.

All schemas defined in **Drizzle**, applied via `drizzle-kit push`.
Runtime queries can be Drizzle query-builder calls (simple) or raw
`sql\`...\`` template tags (analytics math) — both go through the same
postgres.js client per package.

Tests use a single shared helper `truncatePg()` from
`@engineerdad/shared/test-helpers`, called in `beforeEach`. The whole
suite runs serially (`vitest.config.ts` sets `singleFork: true` +
`sequence.concurrent: false`) so truncate-all is safe.

## Consequences

**Removed:**
- `node:sqlite` imports across `packages/{orchestrator,analytics,experiment}`.
- `data/engineerdad.sqlite` and WAL/SHM files.
- Four raw SQL migration files (orchestrator + analytics).
- Vitest `node:sqlite` external.
- Three local `truncateAll` clones in store tests; owned-id cleanup in
  orchestrator-postgres tests.

**Added:**
- Drizzle schemas + drizzle.config.ts for orchestrator and analytics
  packages.
- `packages/shared/src/test-helpers/truncate-pg.ts`.
- This ADR.

**Tradeoffs:**
- Tests now require a running Postgres (Docker via `pnpm store:up`).
  Acceptable — already required for store + step_results tests.
- Wall-clock test time +4-6s due to forced serial execution. Bounded by
  the static-renderer Playwright test (12s ceiling either way).
- One-way migration: no SQLite fallback. Rollback is a revert + `pnpm
  install`.

## See also

- `docs/superpowers/specs/2026-05-26-e-034-sunset-sqlite-design.html` —
  the design spec.
- `docs/superpowers/plans/2026-05-26-e-034-sunset-sqlite.md` — the
  implementation plan (this work).
