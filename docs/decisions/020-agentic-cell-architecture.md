# 020 — Agentic-cell architecture: an orchestrator state machine, four reasoning cells

**Status:** Accepted (2026-05-22)

**Source:** `docs/superpowers/specs/2026-05-22-agentic-rebuild-design.html` (the agentic-rebuild design) + `docs/superpowers/specs/2026-05-21-orchestrator-placement-design.html` (orchestrator placement). Written after the 7-phase implementation plan shipped — an ADR records a settled decision.

## Context

The pre-rebuild OS ran the closed loop through `brain` as a four-tier router: `brain` read a slash-command mode, applied a 9-step reasoning scaffold, then dispatched the seven leaf agents (`tracking`, `analytics`, `targeting`, `content-gen`, `media-production`, `experiment-os`, `distribution`) in sequence. Three structural problems followed from that shape:

1. **Deterministic logic lived in agent prompts.** Slug derivation, ID minting, truncation, category maps, channel selection, schedule math — all pure functions — were prose instructions an LLM re-derived every run. The "G-series" regressions (G10/G11/F2/Step-7.0 and others) recurred because a prompt is not a test.
2. **Sequencing was an agent's judgement.** `brain` deciding *which agent next* is open decision space the loop did not need — the order is fixed. Every run paid LLM tokens and LLM variance for a deterministic walk.
3. **Doctrine lived in a 754-line working spec.** `PLAN.md` was cited by section number from agent prompts; it drifted from the code and from the ADRs.

## Decision

**The loop is a typed state machine. Reasoning is isolated into four cells.**

- **The orchestrator owns sequencing.** `packages/orchestrator` holds the pure logic — `plan` / `verify` / `advance`, one `StageDefinition` per stage, and a verifier per step. `plan` is a pure function of persisted run state, so a run is resumable and re-callable. `mcp-servers/orchestrator` is a thin stdio wrapper over it (ADR-005 thin-adapter doctrine — same shape as analytics/notion). The `/loop` command is a domain-agnostic conductor: `plan` → execute the `Step` → `verify` → `advance`, repeating until a gate or completion. It owns *effort*; the orchestrator owns *termination*.

- **Four agentic cells, everything else deterministic.** The **agentic litmus test**: a step is agentic only if it has genuine open decision space — a judgement a verifier could not make. By that test exactly four cells are agentic:
  - `brain` (Strategy) — the §B 9-step reasoning scaffold → the Decision Memo.
  - `brief-writer` — the Memo's angles → 12 message-based Briefs.
  - `content-writer` — approved Briefs → hook banks, scripts, AEO/GEO articles.
  - `creative-director` — approved Scripts → the creative plan (storyboard, hook register, thumbnail brief — taste only).

  Everything else is a deterministic `StageDefinition` (`tracking`, `analytics`, `synthesize`-spawn, `schedule`, `experiment`, `distribute`) or a fan-out render worker. Deterministic transforms are pure, unit-tested functions in `packages/shared` — not prompt prose.

- **The live loop is the ordered design-§8 registry.** `LIVE_REGISTRY`: `tracking → analytics → synthesize → brief → content → produce → schedule → experiment → distribute`. The four human gates are `gate` steps inside the stages (HG1 brief, HG2 content, HG3 produce, HG4 distribute); the conductor STOPs there.

## Retained from ADR-005

ADR-020 supersedes ADR-005's *dispatch* model (agents orchestrating cross-server calls) but **keeps its doctrine intact**:

- **Thin-adapter doctrine.** An MCP server is a thin adapter over an API or a `packages/` library; logic worth testing lives in the package, not the server.
- **No-MCP-mesh rule**, restated precisely: *no MCP server opens a client connection to another MCP server.* Shared **logic** goes in a `packages/` library; cross-server **sequencing** goes through the hub (the `/loop` conductor + the orchestrator). This is not "deterministic code can't call deterministic code."
- **Compliance boundary.** The compliance scan fires at the notion MCP write boundary — the single auditable choke point. The orchestrator *computes* the write calls; the conductor *executes* them against the notion MCP; the scan runs there. Orchestration state is never written to Notion.

## Resolves

- **ADR-014's worker-split question.** Render workers materialize static PNGs here (the PNG *is* the artifact Meta consumes); cross-repo artifacts (engineerdad-site articles) still cross the boundary as a spec to `mcp__engineerdad_site__draft_article`. The ADR-014 + ADR-016 carve-out stands unchanged.

## Consequences

- `/loop` is the conductor; `/status` is the run dashboard. The granular commands (`/produce`, `/content`, `/experiment`, `/distribute`, …) survive as scoped delegators to the conductor — power-user escape hatches, not a second dispatch path.
- Orchestration state is two SQLite tables (`runs`, `run_steps`) in `data/engineerdad.sqlite`; Notion owns artifacts + gate signals. The sync is asymmetric — the orchestrator only *reads* Notion approval columns to detect a cleared gate, and `verify` re-reads Notion for artifact truth (doubling as the divergence detector).
- `brain` is trimmed from a 412-line router to a reasoning leaf — the 9-step scaffold, the Memo structure, the move catalog, cold-start handling. It does not dispatch.
- Doctrine moves out of `PLAN.md` (retired) into `ARCHITECTURE.md` (the current snapshot) + the ADRs.

## Alternatives considered

- *Keep `brain` as the router, extract only the deterministic transforms.* Rejected: it fixes the G-series but leaves sequencing as LLM judgement and variance on every run.
- *One MCP server that internally sequences the others (an orchestration mesh).* Rejected: violates the no-MCP-mesh rule and collapses the compliance choke point. Sequencing belongs in the hub.

## Implementation refs

- `packages/orchestrator/src/` — `engine.ts` (`plan`/`verify`/`advance`), `stages/*.ts`, `verifiers/*.ts`, `registry.ts` (`LIVE_REGISTRY`).
- `mcp-servers/orchestrator/src/index.ts` — the thin stdio wrapper.
- `.claude/commands/loop.md` — the conductor; `.claude/agents/{brain,brief-writer,content-writer,creative-director}.md` — the four cells.
