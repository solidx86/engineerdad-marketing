# 004 — Notion bootstrap

Status: Accepted
Date: 2026-05-06
Source: TASKS.md Phase 2

## Context

The OS uses 8 Notion databases as the human-review surface and durable system-of-record (Briefs, Scripts, AuthorityArticles, CreativeVariants, Experiments, PerformanceReports, Hypotheses, Learnings). Bootstrap creates them once under a parent page and writes the IDs to a local file consumed by the notion MCP server. PerformanceReports ↔ Hypotheses is a relation cycle that has to be broken at creation time.

## Decision

- **Two-phase creation** to break the `PerformanceReports ↔ Hypotheses` relation cycle: pass A creates all 8 DBs with non-relation properties, pass B issues `databases.update` to attach 10 relation properties. Order-independent; safer for future schema additions.
- **Property layout**: bilingual fields stored as two separate Notion properties (`Body EN` / `Body BM`, etc.) — `@engineerdad/shared` keeps the `{en, ms}` object shape; the notion MCP server (ADR-005) maps at the boundary.
- **`Angle`** (Briefs) is a `select` with an empty options list — Brain populates options on the fly via the Notion API's add-on-write behavior, so new angles don't require a code change.
- **Backoff strategy**: exponential (500ms → 16s ceiling, 6 attempts) on `429` and `5xx`. All Notion writes go through one `withBackoff` wrapper.
- **Repo-root resolution**: bootstrap walks up from `import.meta.url` until it finds `pnpm-workspace.yaml`, so `data/notion-ids.json` always lands at the repo root regardless of cwd.
- **`.env` loading**: `node --env-file=../../.env` (Node 20.6+) instead of pulling in `dotenv`. Zero runtime deps for env wiring.
- **Root `bootstrap:notion` script** runs `build && start` so a fresh clone (no `dist/`) works first try.
- **`data/notion-ids.json` is gitignored**; regenerated on demand. New machines must re-run `pnpm bootstrap:notion` and copy the file from secure storage if they want to keep the same DBs.

## Consequences

- New relations between DBs land via pass-B migrations (`migrate-pass-b.ts`-style scripts), not full re-bootstrap. Idempotent — Notion's `databases.update` merges properties.
- DB IDs are workspace-local — moving to a new Notion workspace requires re-bootstrap + ID file regeneration.
- Repo-root walker means MCP servers can be spawned from any cwd by Claude Code.
