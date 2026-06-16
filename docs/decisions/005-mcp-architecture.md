# 005 — MCP architecture

Status: Accepted
Date: 2026-05-06
Source: TASKS.md Phase 3b/3c "Decisions locked"

> **Status note (2026-05-22):** the "agents orchestrate cross-server calls" dispatch model is superseded by ADR-020 (orchestrator state machine). The thin-adapter doctrine, the no-MCP-mesh rule, and the compliance-scan boundary below all stand.
>
> **Status note (2026-05-24):** ADR-023 makes explicit what was previously implicit: *inside the workspace, prefer library imports over MCP stdio calls.* The orchestrator MCP imports `packages/<name>/` directly to execute mechanical work — this is not a mesh edge (no client connection between MCP servers), it is a same-process library call. The no-MCP-mesh rule continues to apply at the MCP protocol surface; the new doctrine extends ADR-005 by clarifying that the thin-adapter pattern is also what makes orchestrator-resident execution possible. Every new MCP server should land with its business logic in a sibling `packages/<name>/`.

## Context

The OS exposes 5 MCP servers (analytics, meta-ads, notion, corpus, experiment) over stdio. Agents call them; they don't call each other. This ADR captures the doctrine that's true across all five — server-specific decisions live in the per-server ADRs (006–009).

## Decision

- **MCP framework**: `@modelcontextprotocol/sdk` ^1.18 with `McpServer.tool()` API. Each server registers tools with Zod input schemas; tool handlers return `{ content: [{type:"text", text: JSON.stringify(...) }] }` and use `isError: true` for errors instead of throwing into stdio.
- **HTTP client**: native `fetch` (Node 20+) for both Meta Marketing API and the Graph CAPI endpoint. Zero extra deps.
- **MCPs don't call each other.** Cross-server data access happens at the storage layer (e.g., experiment MCP reads `data/engineerdad.sqlite` directly that analytics MCP writes; notion MCP reads `data/notion-ids.json` that bootstrap writes). Agents orchestrate the cross-server calls.
- **Notion DB IDs**: loaded once at server start from `data/notion-ids.json`, cached. Server walks up from `import.meta.url` to find repo root, so cwd doesn't matter when Claude Code spawns the stdio server.
- **Compliance scan trigger** (notion MCP): only the four content DBs (`Briefs | Scripts | AuthorityArticles | CreativeVariants`) — `CONTENT_DBS` set in `db-ids.ts`. PerformanceReports/Experiments/Hypotheses/Learnings skip the scan as internal artifacts.
- **Bilingual scan policy** (notion MCP): `extractTextByLang` walks the Notion `properties` payload, routing fields by ` EN` / ` BM` (or parenthesized) suffix into per-language buckets. Fields without a suffix go to EN. Each non-empty bucket is scanned independently; empty buckets fail with a `no_<lang>_content` violation (every artifact must be bilingual).
- **`Compliance Check` checkbox is server-set**: when `complianceScan` passes for a content DB, the notion MCP injects `Compliance Check: { checkbox: true }` into the page properties before creating it. The flag reflects reality, not whatever the agent claims.
- **Tool I/O shape**: `query`, `update_page`, `append_blocks` accept the raw Notion-API shape (`Record<string, unknown>`) per the thin-adapter doctrine — no typed wrappers in v1. The notion MCP is a thin adapter; agents construct Notion property objects.
- **Thin-adapter doctrine**: transformation belongs at the MCP boundary, not in agent prompts. Agents are stochastic; MCPs are deterministic. Examples: server-side raw-Meta-row canonicalisation (ADR-006), server-side runId minting (ADR-011), `chunkRichText` 2000-char splitter (ADR-012).

## Consequences

- Adding a new MCP server is a stdio module + Zod schemas + a settings.json registration. No cross-server import dance.
- Schema validation at server boundary catches whole classes of agent drift (e.g., 8.13 strict filter schema rejected pre-stringified JSON instead of failing opaquely at the Notion API).
- Storage-layer coupling between MCP servers (sqlite path, notion-ids.json path) is real but bounded — both servers live in this repo, both are owned by the same team.
