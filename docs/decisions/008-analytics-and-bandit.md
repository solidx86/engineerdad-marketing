# 008 — Analytics & bandit

Status: Accepted
Date: 2026-05-06
Source: TASKS.md Phase 3a/3e "Decisions locked"

## Context

The analytics MCP is the OS's signal layer: it ingests Meta insights into a local SQLite, computes decay curves and cost-per-angle, and runs the Beta-Bernoulli + Thompson Sampling bandit that allocates next-week budget. This ADR captures the math choices, the SQLite driver swap, and the reason the MCP signature deviates from the original design spec.

## Decision

### SQLite driver

- **`better-sqlite3` → Node 24 built-in `node:sqlite`**. `better-sqlite3` 11.x failed to compile on the user's Darwin 25.3.0 (climits header missing — Xcode CLT issue). Node 24's `node:sqlite` (DatabaseSync / StatementSync) ships with Node and needs no native build. Trade-off: an `ExperimentalWarning` on startup; API stable enough for v1. Imported via `createRequire` to dodge Vite's static-import resolver (which strips the `node:` prefix and breaks vitest).
- **Migration delivery**: `001_init.sql` shipped as a raw `.sql` file copied into `dist/migrations/` by a postbuild step (`node -e ... cpSync`). The DB layer reads from `dist/migrations/` at runtime, `src/migrations/` during dev.
- **Vitest config knock-on**: root `vitest.config.ts` sets `pool: "forks"` and `server.deps.external: ["node:sqlite", /^node:/]` to avoid Vite trying to bundle Node builtins. With `createRequire` in `db.ts`, the static-analysis path is also bypassed.

### `ingest_meta_insights` signature deviation from the original design spec

- **Takes `{rows: MetaInsightRow[]}` instead of `{since: string}`.** Reasons: (a) keeps analytics MCP network-free / no `META_TOKEN` blast radius, (b) the Phase 4 analytics subagent already has both `meta-ads.*` and `analytics.*` in its allowlist so it pipes one into the other, (c) trivially testable with synthetic rows.
- Server-side raw-row canonicalisation lives at the meta-ads MCP boundary (see ADR-006). The analytics MCP receives rows in canonical shape.

### Bandit math

- **Bandit arms = cross-product over the requested `arm_tags` only** (not the full hook×angle×format×persona×language space). Caller controls cardinality — start with `["hook","angle"]` (~25 arms on this consultant's volume); broaden when data thickens. Arms requiring tags an ad doesn't have are silently dropped (with a `notes` entry if the result is empty).
- **Beta-Bernoulli posterior**: per arm, `α = leads + 1`, `β = (impressions - leads) + 50` (weak prior favoring zero-conv). CPA distribution = (sampled CPM / 1000) / sampled conversion-rate, sampled via Marsaglia gamma → beta. 200 samples per arm per allocate call. Posterior uncertainty reported as P10–P90 spread.
- **70/20/10 bucket labels are a *consequence* of allocation quartiles, not pre-decided** — top quartile of arms by share → "70", next half → "20", tail quartile → "10". Matches the §12.2 doctrine.
- **Cold-start strategy is a v1 placeholder**: `proof_led` is documented in `notes` but currently uses the same uniform Beta prior as `uniform`. Wired to `corpus.list_proof`. Cold-start arms (`n_pulls < 3` or `<1000` impressions) are counted and surfaced in `cold_start_arms`.

## Consequences

- No native build dependency in v1 — pnpm install works on any Mac with Xcode CLT issues.
- Analytics MCP stays stateless re: Meta credentials — the agent layer holds the token.
- Bandit cardinality grows with data volume, not at design time. Brain currently runs with `["hook","angle"]`; can broaden post run_2.
- Cold-start prior is intentionally pessimistic (`β=51` until first conversion lands) — prevents the bandit from over-exploring an unproven arm on tiny `n`.

---

## Update — Superseded by E-034 (2026-05-26)

The storage substrate decisions in this ADR have been superseded by
**E-034 (Sunset SQLite)** and **ADR-025 (Postgres-only)**.
See `docs/decisions/025-postgres-only.md`.

What changed:
- Analytics tables now live in `analytics.*` in the engineerdad
  Postgres DB, not in `data/engineerdad.sqlite`.
