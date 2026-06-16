# ADR-027: DB migration policy and branch sandbox isolation

**Date:** 2026-05-26
**Status:** Accepted
**Builds on:** ADR-025 (postgres-only substrate)
**Tracker:** E-035

## Context

ADR-025 moved everything to Postgres but left three footguns unfixed:

1. Root `db:push` ran `drizzle-kit push` against the live `engineerdad` DB with no branch isolation.
2. All branch dev work shared the live DB — schema divergence between branches was invisible.
3. `truncatePg()` had no DB safety check. With `DATABASE_URL` pointing at `engineerdad`, every `beforeEach` in the test suite truncated the live DB. This happened.

## Decision

**Branch sandboxes.** Each branch gets its own `engineerdad_sb_<slug>` database. `pnpm db:sandbox` creates it, pushes all three schemas, and writes `DATABASE_URL` to `.env.local`. Vitest picks up `.env.local` over `.env` automatically.

**Versioned migrations.** Per-package `drizzle/` folders hold generated SQL. `drizzle-kit push` remains for sandbox dev (fast iteration). `pnpm db:generate` produces committed SQL. `pnpm db:migrate` applies migrations to the live DB post-merge. CI lint (`pnpm lint:migrations`) rejects commits that modify `schema.ts` without a corresponding SQL file.

**`truncatePg()` guard.** Throws at module load if `DATABASE_URL` doesn't end with `_test` or contain `engineerdad_sb_`. Hard-stops the suite before any data is touched.

**Root `db:push` retired.** Individual package `push` scripts remain as internal primitives called by `db:sandbox`.

**CLAUDE.md** carries operational rules so Claude Code follows the policy without being told each session.

## Consequences

- Tests require `pnpm db:sandbox` on first branch use. Suite hard-stops on wrong `DATABASE_URL` — intentional.
- Schema changes require `db:sandbox` + `db:generate` before committing.
- Post-merge: run `pnpm db:migrate` once against the live DB.
- Two branches can run `/loop` simultaneously against their own sandboxes without `run_id` collision.
- Live DB recovery after a wipe: `pnpm db:migrate` on a fresh `engineerdad` DB, then cold `/loop`.

## See also

- `docs/superpowers/specs/2026-05-26-db-migration-sandbox-design.html` — design spec
- `docs/superpowers/plans/2026-05-26-db-migration-sandbox.html` — this work
