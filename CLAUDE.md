# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A closed-loop "Marketing OS" of 7 subsystems (Data → Intelligence → Execution) for EngineerDad — Shoo Kyuk Wei's Public Mutual unit trust + PRS consultancy targeting Malaysian parents. The authoring substrate is Claude Code itself: subagents + slash commands + MCP servers. **Every external write is human-gated through the webapp at http://localhost:3030.**

## Where to look first

| File | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | Current architecture — source of truth for the system as built. |
| `docs/TASKS.md` | Open work and build status — **open items only**. |
| `docs/archive/DONE.md` | **Archived/frozen (2026-06-17) — read-only history; never edit.** Past closed bugs/enhancements + shipped-milestone history. |
| `docs/decisions/` | ADRs — see `docs/ARCHITECTURE.md` § *Where doctrine lives*. |
| `.claude/agents/*.md`, `.claude/commands/*.md` | The runtime surface — 6 subagents (4 agentic cells + `render-worker` + `chart-author`), 14 slash commands. |
| `.mcp.json` | MCP server registry. |

## Build / dev commands (the non-obvious ones)

- **`pnpm -r build` — sequential only.** Never `pnpm -r --parallel build` or the alias `pnpm build`; the parallel form races on `@engineerdad/shared` and intermittently fails.
- **`pnpm -r build` collides with a running `next dev`.** The workspace build runs `next build` against `apps/webapp/`, which overwrites the dev server's live `.next/` chunks under new IDs and produces `Cannot find module './<n>.js'` in the browser. Either stop `next dev` first or skip the webapp: `pnpm -r --filter='!@engineerdad/webapp' build`. If you already collided, kill the dev server, `rm -rf apps/webapp/.next apps/webapp/node_modules/.cache`, then restart.
- **`pnpm sync:agents`** — re-pastes prompt fragments from `packages/shared/src/prompts/*.md` into `.claude/agents/*.md`. Run after editing any prompt fragment. CI form: `pnpm sync:agents:check`.
- **Cold-start DB setup** — run `pnpm db:sandbox` to create the branch sandbox, then `pnpm db:migrate` to apply migrations to the live `engineerdad` DB after merging. See "Database workflow" below.
- **`pnpm test:worker <fixture>`** exercises the static-renderer asset pipeline (ADR-014).
- Single test: `pnpm vitest run <path>` or `pnpm vitest <pattern> -t "<test name>"`.
- After editing `.claude/settings.json` or `.mcp.json`, **restart Claude Code** so MCP registrations reload.

## Database workflow

- **Do not (re-)add a root `db:push` script** — it was retired because it targeted the live DB directly. The per-package `push` scripts still exist (used only by `db:sandbox`), and a bare `drizzle-kit push` defaults to live `engineerdad` when `DATABASE_URL` is unset — so re-aggregating them into a root `db:push` is an easy, dangerous mistake. Use `db:migrate` (journaled, idempotent) instead.
- **Before running tests**, ensure `DATABASE_URL` in `.env.local` points at an `_test` or `engineerdad_sb_*` database. `truncatePg()` hard-stops the suite if it doesn't — this is intentional.
- **`pnpm db:sandbox`** — run once per branch, and again after any `schema.ts` change during dev. Derives DB name from the current git branch, creates it if needed, pushes all three schemas, writes `DATABASE_URL` to `.env.local`.
- **`pnpm db:snapshot`** — clone live `engineerdad` data into the current branch sandbox. Run after `pnpm db:sandbox`; re-run anytime you want fresher live data. Targets the branch sandbox automatically — no-op on `main`.
- **Committed snapshot layout** — `data/snapshots/<branch>/<gate>-<runId>/engineerdad.sql`. **Always nest under a parent folder named for the branch the snapshot was taken on, including `main`** (e.g. `data/snapshots/main/hg1-run_1779895374/`). Each is a whole-DB plain `pg_dump --no-owner --no-acl --clean --if-exists` (one `engineerdad.sql` per gate; carries all three schemas + the drizzle journal).
- **Schema change on a branch** — edit `schema.ts`, run `pnpm db:sandbox` (apply to sandbox), then `pnpm db:generate` (produce SQL). Commit `schema.ts` + the generated files in `packages/*/drizzle/` together. `pnpm lint:migrations` enforces this.
- **After merging to main** — run `pnpm db:migrate` against the live `engineerdad` DB once. `db:migrate` targets `process.env.DATABASE_URL` (drizzle-kit does **not** auto-load `.env.local`; unset → falls back to the live default). To migrate a specific DB: `DATABASE_URL=<url> ALLOW_LIVE_DB=1 pnpm db:migrate`.
- **Live + snapshots are journaled (since 2026-05-30).** Each package has its own journal table `drizzle.__drizzle_migrations_{store,orchestrator,analytics}` (B-032 fix), so `db:migrate` is idempotent. Whole-DB `pg_dump` snapshots carry the `drizzle` schema, so restore + `db:migrate` is a clean no-op. drizzle-kit decides what to apply by each migration's `created_at`/`when` timestamp, **not** by file hash.
- **Adopting migrations on an already-populated DB with no journal** — do **not** let `db:migrate` re-run `0000` (CREATE TABLE fails on existing objects). Seed the journal first: one row per already-applied migration into `drizzle.__drizzle_migrations_<pkg>` with `hash` = `shasum -a 256 <migration>.sql` and `created_at` = that entry's `when` from `_journal.json`; then `db:migrate` applies only the newer ones. Rehearse on a throwaway `CREATE DATABASE … TEMPLATE engineerdad` clone before touching live.
- **`pnpm db:sandbox:drop`** — run occasionally to drop sandbox DBs whose branches are gone.
- **MCPs respect `.env.local`.** All DB-touching MCP servers load `.env` first, then `.env.local` if present (last-wins). Branch sandboxes Just Work after a `pnpm db:sandbox`; main with no `.env.local` stays on live. Restart Claude Code after the first `db:sandbox` on a branch so the MCP layer picks up the override.
- **Override escape hatch.** Set `ALLOW_LIVE_DB=1` to bypass the branch-safety guard. Used by `db:migrate` and `db:snapshot` themselves; anything else should think twice.
- **Querying the DB.** Use `docker exec engineerdad-postgres psql -U engineerdad -d <db> -c "..."` for any read or one-off patch. The host has no psql binary — do not invent alternatives (Node scripts with `pg`, custom inspect helpers, etc.). For the live DB use `-d engineerdad`; for the branch sandbox read the URL from `.env.local`.

## Architecture — the big picture

### The closed loop

tracking → analytics → synthesize → brief → **[HG1]** → content → **[HG2]** → produce → **[HG3]** → schedule → experiment → distribute. `/reflect` closes the loop afterward. Entry point: `/loop`. (Distribute is terminal — no gate; under the default `META_PAID_MODE=manual` the Meta-paid ads are posted by hand from the webapp posting pack.)

### Three layers, one direction

- **`.claude/agents/*.md`** — 4 agentic cells (`brain`, `brief-writer`, `content-writer`, `creative-director`) + 2 non-cell workers (`render-worker` for the produce stage, `chart-author` for the out-of-loop `/chart-gap` utility).
- **`mcp-servers/*` + `packages/`** — 15 stdio MCP servers (thin adapters) over deterministic package libraries.

→ See `docs/ARCHITECTURE.md` for the full map (stages, orchestrator internals, storage, command surface, MCP servers).

## Load-bearing ADRs

See `docs/ARCHITECTURE.md` § *Where doctrine lives* before making cross-cutting changes. Read the ADR file itself before touching its named surface.

## Superpowers skills — output format

When using superpowers brainstorming or writing-plans skills, output format is:
- Specs: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.html` — HTML only, no sibling MD.
- Plans: `docs/superpowers/plans/YYYY-MM-DD-<topic>.html` + `YYYY-MM-DD-<topic>.md` — both files, same content.

HTML: inline styles only (no external CSS), must render correctly when opened directly in a browser without a server.

## Maintenance

- **Architectural change** (new MCP server, stage, agent, or storage layout) → update `docs/ARCHITECTURE.md`; keep this file's big-picture summary in sync.
- **Bug or enhancement uncovered** → open a new entry in `docs/TASKS.md`.
- **Work ships / ticket closes** → mark the entry done (or remove it) in `docs/TASKS.md` and refresh the Status header. **Do not move it to `docs/archive/DONE.md` — that file is archived/frozen.**
