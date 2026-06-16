# 011 — Server-side runId minting

Status: Accepted
Date: 2026-05-09
Source: TASKS.md Phase 8.8

> **Status note (2026-05-22):** superseded — the orchestrator now mints runIds itself in `packages/orchestrator/src/engine.ts` (`run_<unix_seconds>`, the same formula). The `mcp__analytics__new_run` tool and brain's call to it are retired (B-014); agentic cells receive the runId from the orchestrator's spawn prompt. The principle below — a system-clock value belongs in code, not an agent prompt — still stands.

## Context

Brain originally computed `runId` inline in the agent prompt: "convert today's date string to unix seconds, add 12·3600". This worked for the first few runs but produced timestamp drift — LLMs mimic example numbers in their context even when instructed otherwise. A run-1 dispatch carried a stale cosmetic runId in titles even though subagent dispatch (queried by `Run ID` property) was unaffected. Cosmetic today, dispatch-breaking tomorrow if the prompt drifts further.

## Decision

- **Add `mcp__analytics__new_run` tool** to the analytics MCP server (`mcp-servers/analytics/src/index.ts`). Takes no args; returns `{ runId: "run_<unix_seconds>" }` from `Math.floor(Date.now() / 1000)` on the live server clock — no date-math in agent context, no way to produce a stale value.
- **`brain.md` updated**:
  - `mcp__analytics__new_run` added to the frontmatter tools list.
  - The `plan-next-week` dispatch row mandates calling the tool as the **first action** instead of computing inline.
  - The old verbose "convert today's date string, add 12·3600" instruction removed — that was the footgun.
- **Historical**: `run_1778212001` pages from Phase 7.5 still carry stale cosmetic references in their title strings, but subagent dispatch (queried by Run ID property) was unaffected then and remains unaffected now.

## Consequences

- Server clock is the single source of truth for runId — guaranteed monotonic across runs.
- Pattern generalises: any string with a "system clock" semantic (timestamps, run IDs, cycle markers) belongs in an MCP tool, not an agent prompt.
- 14/14 analytics tests pass post-change.
