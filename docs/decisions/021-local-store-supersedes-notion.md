# 021 — Containerised Postgres + review UI supersedes Notion as the human-gate substrate

**Status:** Accepted (2026-05-23, updated with Postgres-in-Docker substrate decision)

**Source:** `docs/superpowers/specs/2026-05-23-e-029-replace-notion-design.html`. Written alongside the E-029 implementation spec — both committed together — to record the doctrine shift before the migration begins.

## Context

The pre-E-029 OS used Notion as both the data store and the human-gate UI. Eight Notion DBs held the four artifact types (Briefs, Scripts, AuthorityArticles, CreativeVariants) plus four signal types (Experiments, PerformanceReports, Hypotheses, Learnings). `mcp-servers/notion/` was the thin adapter; `packages/notion-bootstrap/` owned schema-as-code + 14 live-workspace `migrate-*` scripts. Humans approved at HG1–HG4 by flipping `Approval Status` in the Notion UI.

Two architectural defects accumulated:

1. **The MCP wire cap fires on bulk content.** The conductor's inline tool-result cap (~32k tokens) applies to every stdio response from any MCP server. The first real produce-stage walk after E-027 hit the wall at `P0-scripts` — 70k chars across 6 approved Scripts, spill-to-disk fired, the orchestrator MCP could not have returned the subsequent `P1-fanout` step's payload at all. E-027 bounded *per-worker* context; the conductor↔orchestrator boundary remained.

2. **The substrate-shape leak.** ADR-012 (rich_text 2000-char chunking), the `filter_properties` token tax, Notion's per-row API latency (~150 ms), the 14 `migrate-*` scripts that risked live-workspace coordination drift — all existed *only* because the substrate was Notion. They were never load-bearing for marketing OS doctrine; they were load-bearing for Notion.

`docs/war-room-wishlist.md` (filed earlier the same day) gated against building a custom UI on the strength of one friction. That gate still applies — but a separate decision, on different evidence, moved the substrate first; the UI came along because we were already there. The wishlist's discipline is intact.

## Decision

**The OS's data store is Postgres, running in Docker compose with the data volume bind-mounted to `./data/postgres/` (gitignored). The human-gate UI is a single-user Next.js app served on localhost:3030. Notion is no longer in the dependency graph.**

- **The store owns artifact + signal persistence.** `packages/store` holds the typed schema (Drizzle pgTable), filter DSL, CRUD library, and compliance integration. It is the canonical data layer. `mcp-servers/store/` is the thin stdio wrapper — five tools: `query`, `get`, `create`, `update`, `set_status`. ADR-005's thin-adapter doctrine is preserved.

- **The MCP surface is cap-honouring by design.** `query` returns IDs (and small index columns by opt-in) only, *never* bulk content. The only path to read bulk content is `get(id)`. Workers in a fanout each do one `get` on their assigned unit — one bulk crossing per worker, safely within the 200k subagent window and far under the wire cap.

- **The substrate is containerised, not embedded.** Postgres 16-alpine runs as a service in `docker-compose.yml`. Data persists in `./data/postgres/` (bind mount). Localhost-bound (`127.0.0.1:5432`). The data directory is `.gitignore`d — clone has no data, cold-start is the only way in. Backup is `pg_dump` on demand (tooling deferred until pain).

- **`apps/review-ui` is the human-gate substrate.** Next.js 15 App Router, single user, localhost-bound (`127.0.0.1:3030`). Server actions persist edits and status flips through `packages/store`. Eight entities, one generic field-rendering component, table-driven. Playwright covers every UIUX-touching surface. The war-room wishlist remains the gate for any feature addition.

- **Notion exits the dependency graph completely.** `mcp-servers/notion/` and `packages/notion-bootstrap/` are deleted; `.mcp.json` no longer registers Notion; no agent prompt mentions a `mcp__notion__*` tool.

## What stays on SQLite

The orchestrator's `runs` + `run_steps` tables remain in `data/engineerdad.sqlite` — they're run-state plumbing, ephemeral, never human-reviewed, never exceed the wire cap. Two stores side-by-side is correct: SQLite for orchestration state (zero-config, in-process), Postgres for the eight entity tables (real types, real concurrency, the review UI's substrate).

## Retained from ADR-005 and ADR-020

- **Thin-adapter doctrine intact.** `mcp-servers/store/` is a thin wrapper over `packages/store`. Logic worth testing lives in the package.
- **No-MCP-mesh rule intact.** `mcp-servers/store/` opens no client connection to any other MCP server. Cross-server sequencing remains the orchestrator's job.
- **Compliance choke point intact.** The compliance scan moves from `mcp-servers/notion/src/handler.ts` into `packages/store/src/crud.ts`'s `create` / `update` paths. Both the MCP path (worker writes) and the UI path (server actions) go through the same function — the boundary is layer-aware now, not transport-aware. Same audit, same refusal shape.

## Supersedes

- **ADR-012 (rich_text 2000-char chunking).** The 2000-char limit was a Notion API property. Postgres `text` columns have no such limit. The chunking code is deleted with the rest of `mcp-servers/notion/`.

- **ADR-005 §"Compliance boundary fires at the notion MCP write boundary."** Now reads: "fires at the store-package write boundary." Otherwise unchanged.

## Resolves

- The MCP-wire-cap class of failures on every stage that lives behind `mcp-servers/store/`. E-027's first walk failure (`run_1779446750` at `P0-scripts`) is the canonical example.

- The schema-migration operational risk. `drizzle-kit push` is a local container-side command applied with `pnpm store:push`; no live-workspace coordination, no partial-state risk.

- The `better-sqlite3` native-build friction. `postgres.js` is pure JS.

## Consequences

- **The OS is no longer a single-machine zero-dependency artifact** — Docker is now a prerequisite. The trade-off was made deliberately: the operational cost (run `docker compose up -d` before working) buys real DB primitives (`jsonb`, real enums, true transactions, concurrency), zero native-build pain, and a future-proof substrate.

- **Data is no longer in git.** Clone the repo → run `pnpm store:up && pnpm store:push` → empty DB. Cold-start is the only way in. Backup is `pg_dump` on demand (tooling deferred).

- **First-time setup**: install Docker, then `pnpm install && pnpm -r build && pnpm store:up && pnpm store:push && pnpm review`. Browser at `localhost:3030`.

- **The `mcp__notion__*` allow-list disappears from `.claude/settings.json`; agent prompts shorten.

- **`packages/orchestrator/src/state.ts`'s SQLite path is unchanged.** Two stores side-by-side, each fit for purpose.

## Alternatives considered

- **Local SQLite store (Drizzle + better-sqlite3).** The original E-029 direction. Rejected after the user weighed Postgres trade-offs: the wins on JSONB indexing for E-028, pure-JS client, real concurrency, and future-proofing for hosted/remote scenarios outweighed the Docker dependency and the loss of the "data in git" property. The minor operational overhead of `docker compose up -d` is acceptable to the single-machine single-user workflow.

- **Spill-to-disk at the orchestrator MCP boundary (B-017-shaped).** Considered as the in-day unblock for the E-027 walk. Rejected as the doctrine answer because it tolerates the bulk-crossing pattern rather than eliminating it.

- **Keep Notion; redesign the MCP surface alone.** The thin surface needs cheap per-ID reads to be economical; Notion's per-row API latency makes that unworkable. A local store (SQLite or Postgres) was the enabling change.

- **Keep Notion as the human-gate UI; mirror to local store for orchestrator reads.** Rejected — leaves the substrate-shape leak (chunking, migrations, rate limits, latency) in place while adding a sync layer. Simpler: one substrate, owned end-to-end.

## Implementation refs

- `docker-compose.yml` — Postgres 16-alpine service, bind-mount to `./data/postgres/`, localhost-only.
- `packages/store/` — schema, CRUD, compliance, filter DSL.
- `mcp-servers/store/src/index.ts` — the thin stdio wrapper.
- `apps/review-ui/` — Next.js 15 App Router, eight entity pages, server actions, Playwright E2E.
- `docs/superpowers/specs/2026-05-23-e-029-replace-notion-design.html` — the implementation contract.
- `docs/superpowers/plans/2026-05-23-e-029-replace-notion.md` — the executable plan.
- `docs/war-room-wishlist.md` — the gating doc for any UI expansion beyond minimum-viable.

---

## Update — Superseded by E-034 (2026-05-26)

The storage substrate decisions in this ADR have been superseded by
**E-034 (Sunset SQLite)** and **ADR-025 (Postgres-only)**.
See `docs/decisions/025-postgres-only.md`.

What changed:
- Beyond store, the orchestrator's run state and analytics signals
  are also Postgres-resident; one DB, three schemas.
