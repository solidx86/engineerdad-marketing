# 012 — Notion rich-text chunking + strict filter schema

Status: **Superseded by ADR-021 (2026-05-23).** The 2000-char chunking existed because Notion's `rich_text` properties capped at 2000 chars per fragment. With Notion retired (ADR-021), Postgres `text` columns have no such limit. The chunking code was deleted with `mcp-servers/notion/`.
Date: 2026-05-08 (superseded 2026-05-23)
Source: TASKS.md Phase 8.9 + Phase 8.13

## Context

Two unrelated-but-adjacent fixes at the notion MCP boundary:

1. Notion's API rejects any `rich_text` fragment whose `text.content` exceeds 2000 characters. This broke trilingual Authority Articles in Phase 7.7 — an EN+BM+ZH body easily clears 2000 chars per language section, especially with embedded disclaimers.
2. The `query` tool's `filter` parameter was typed as `z.unknown()`, which silently accepted JSON strings from agents that pre-stringified — Notion's API then returned an opaque "should be an object" error that masked which agent / which step had drifted.

Both fixes pull responsibility back to the MCP boundary, where it belongs (see ADR-005's thin-adapter doctrine).

## Decision

### Rich-text chunking (8.9)

- **Add `chunkRichText(value)`** in `mcp-servers/notion/src/chunk-rich-text.ts`. Recursively walks any input and splits `{type:"text", text:{content}}` fragments whose content exceeds 2000 chars into multiple ≤2000-char fragments at whitespace boundaries (falls back to hard cut when no whitespace).
- **Applies to both `rich_text` and `title` arrays.** Preserves `annotations` / `text.link` on every split fragment. Leaves `mention` / `equation` fragments untouched. Does not mutate input.
- **Wired into all three notion MCP tools that write content**: `create_page` (properties + children), `update_page` (properties), `append_blocks` (blocks).
- **12 vitest specs** in `src/chunk-rich-text.test.ts` cover: pass-through, multi-piece splits, whitespace-boundary preference, hard-cut fallback, title arrays, multi-fragment inputs, annotation preservation, non-text fragments, block recursion, immutability.

### Strict filter schema (8.13)

- **Tighten Zod schema** in `mcp-servers/notion/src/index.ts:122` from `filter: z.unknown().optional()` to `filter: z.record(z.string(), z.unknown()).optional()` so the entry boundary refuses pre-stringified JSON.
- **`sorts` similarly tightened** to `z.array(z.record(z.string(), z.unknown())).optional()`.
- **Tool description updated** to declare `filter` MUST be an object literal.
- **Smoke test post-restart**: structured `{and: [{Run ID contains run_1778212001}, {Approval Status = Approved}]}` filter against the Briefs DB returned exactly 4 results matching both clauses, `next_cursor: null`.

## Consequences

- Long bilingual content "just works" — agents don't need to know about the 2000-char limit.
- Pre-stringified JSON now fails fast with a Zod error message any subagent can act on, instead of the opaque Notion-API error.
- Same pattern (tighten the boundary, fail loud) was reused for B-002 (`mcp-servers/notion/src/title-validation.ts`, shipped 2026-05-10) — refuses any DB row missing a non-empty title field at the same `create_page` boundary.
