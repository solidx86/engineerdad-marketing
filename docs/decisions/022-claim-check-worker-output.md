# 022 — Workers persist outputs to a step-results store; the conductor carries claim-check refs

**Status:** Accepted (2026-05-24)

**Source:** `docs/superpowers/specs/2026-05-24-e-031-claim-check-design.html`. Written alongside the E-031 implementation spec — both committed together — to record the doctrine shift before the migration begins.

> **Status note (2026-05-24, later same day):** ADR-023 generalizes the principle behind this ADR. The claim-check mechanism here (worker output → ref) remains the canonical fix for boundary A (worker → conductor). A second boundary — orchestrator → conductor, exposed by P3-persist's 238 KB plan envelope on `run_1779611092` — is resolved by ADR-023 with a different mechanism (planner-executes / orchestrator-resident execution) rather than by extending claim-check to a second hop. Both ADRs together instantiate the same umbrella doctrine: *the conductor never holds bulk it doesn't need, and never executes mechanical work the orchestrator can run itself.*

> **Status note (2026-05-25):** ADR-024 closes the trilogy. A third boundary — orchestrator → conductor on the *input* direction, exposed by P1-fanout's 83 KB spawnPrompt envelope on `run_1779670351` — is resolved by ADR-024 by *mirroring* this ADR's mechanism on the input side. The orchestrator now writes per-unit bulk worker-input to `orchestrator.step_results` (the same substrate this ADR built) at fanout-construction time, and embeds only the `stepResultId` in each `spawnPrompt`. Workers call `read_step_result` on entry to fetch their staged input. Same substrate, same `sr_` ref shape, same `read_step_result` tool — just one more direction. The three ADRs together exhaust the bulk-data hops in a fanout cycle.

## Context

The closed-loop conductor (`.claude/commands/loop.md`) drives every `/loop`, `/brief`, `/content`, `/produce`, `/distribute` run. For `fanout` steps it dispatches N `Task` subagents in parallel, then must assemble each worker's final message into a single JSON `result` array and pass that array to `mcp__orchestrator__verify` and `__advance`. The conductor's contract is *transmission middleman*: read worker output verbatim, pass it through to the orchestrator MCP, never reshape.

Two structural problems collided in `run_1779553270` (2026-05-24, walk through P1-fanout):

1. **The Claude Code harness has a ~50 KB inline tool-result cap.** When a subagent's final message exceeds it, the harness persists the full output to `~/.claude/projects/.../tool-results/toolu_*.json` and surfaces a 2 KB preview. P1-fanout's 4 creative-director workers returned ~13 KB each; the conductor saw 4 previews, not the full payloads. The conductor cannot transmit verbatim what it cannot see.

2. **The contract forces hand-reshape.** Even when payloads fit inline, the conductor — an LLM hand-typing JSON across N workers — drops fields, reorders, or truncates. Reproduced in `run_1779549312`/C1-fanout (the E-031 filing repro) and in this session twice: once on P0-scripts/advance (dropped `brief` field, broke produce's hook-bank lookup), once structurally on P1-fanout.

The `loop.md` rule says *"never reshape worker output before verify"* — but the architecture forces reshape *by transmission alone*. Honest workers get rejected because the conductor lost data on the way to the verifier. The rule is honour-system; the architecture overrides it.

Research (2026-05-24, see SPEC §2) confirms this is the **Claim-Check pattern** from Gregor Hohpe's Enterprise Integration Patterns. LangGraph's `Send()` API, Google ADK's handle pattern, Anthropic's multi-agent research system's Memory primitive — every serious multi-agent framework has converged on the same shape. We're rediscovering a 20-year-old EIP and applying it to LLM coordination.

## Decision

**Workers persist their final output to a new `orchestrator.step_results` Postgres table immediately before returning. The worker's final message is a single `{stepResultId: "sr_..."}` ref (~50 bytes). The conductor carries refs only. The orchestrator MCP dereferences server-side before calling the engine's `verify` / `advance`.**

- **Substrate is Postgres**, in a new `orchestrator` schema namespace. `step_results.payload` is `JSONB`. Same Postgres instance as `packages/store`. Future-proof for E-030's plan to collapse `runs` + `run_steps` into Postgres.

- **Two new MCP tools** on `mcp-servers/orchestrator/`:
  - `mcp__orchestrator__write_step_result({runId, stepId, unitIndex?, payload}) → {stepResultId}` — worker persistence.
  - `mcp__orchestrator__read_step_result({stepResultId}) → {payload}` — auditable opt-in transparency for the conductor or any agent that needs to reason over a worker's output.

- **Dereference at the MCP layer, not in the engine.** `mcp-servers/orchestrator/src/index.ts`'s `verify` / `advance` handlers detect the claim-check shape (`{stepResultId}` for spawn, `[{stepResultId}, ...]` for fanout) and resolve refs into payloads before calling `engine.verify` / `engine.advance`. The engine, the verifiers, and downstream `stepResult<T>()` reads all see fully-materialized payloads — unchanged.

- **Hard-cut, no inline back-compat for worker outputs.** Once the four worker agents (brain, brief-writer, content-writer, creative-director) migrate, the MCP schemas reject inline result payloads for `spawn` and `fanout` step kinds. `write` and `gate` kinds keep inline (the conductor assembles their results from MCP calls, not from worker output).

- **Claim-check is the standard name.** Reference Hohpe's EIP catalog in the doctrine. Cross-reference Google ADK's "handle pattern" / "artifact store" / "ephemeral expansion" vocabulary. The naming anchors against precedent rather than inventing local terminology.

## Doctrine — default opaque, opt-in transparent

The "conductor never reshapes worker output" rule is now structurally enforced for transmission. The conductor *physically cannot* hold a payload it has no ref-resolve capability for during normal transmission. Reshape during transmission becomes impossible by construction.

Reasoning over worker output remains possible — but only via an explicit, auditable `read_step_result` tool call. Implicit reshape is gone; audited reasoning is preserved. This matches Google ADK's `LoadArtifactsTool` shape: materialize when needed, never by accident.

The conductor today does not call `read_step_result` during transmission. Future conductor-as-reasoner use cases (failure-aware retry, meta-orchestration, cross-stage reasoning, human debugging) all hook in via this tool without further architectural change.

## What stays on SQLite

`runs` + `run_steps` in `data/engineerdad.sqlite` are unchanged. E-030 will migrate them. `step_results` lives in Postgres now and anchors that migration — it's the first orchestrator-layer table in Postgres, with `runs` + `run_steps` to follow.

## Retained from ADR-005, ADR-020, ADR-021

- **Thin-adapter doctrine intact.** `mcp-servers/orchestrator/` remains a thin wrapper over `packages/orchestrator`. The new write/read tools delegate to functions in `packages/orchestrator/src/postgres.ts`.

- **No-MCP-mesh rule intact.** The orchestrator MCP opens no client connection to any other MCP server. It owns its own Postgres connection alongside its SQLite one.

- **Cap-honouring MCP surface (ADR-021 §"MCP surface is cap-honouring by design") extends naturally.** That decision split entity reads into `query` (IDs only) + `get` (bulk). This decision applies the same shape to worker outputs: `verify`/`advance` carry refs only, `read_step_result` is the bulk path.

- **Compliance scanner remains the entity-write choke point.** Step results bypass it — they're intermediate worker output, not marketing artifacts. The scanner still fires on every `mcp__store__create` for the 8 entities, unchanged. PerformanceReports' documented exemption (brain.md) is unaffected by this change.

## Supersedes

- **The honour-system "never reshape" rule in `.claude/commands/loop.md`.** Now structurally enforced for `spawn` and `fanout` step kinds.

## Resolves

- The hand-assembly reshape vector (E-031 repro: `run_1779549312` C1-fanout, 2026-05-23; `run_1779553270` C1 + P0 advance reshapes, 2026-05-24).

- The Claude Code harness 50 KB inline cap on fanout transmission (`run_1779553270` P1-fanout, 2026-05-24).

- The "what did worker N actually emit?" debugging gap. With `read_step_result`, every worker's exact bytes are inspectable by ID forever (until TTL sweep; see Out of scope).

## Consequences

- **`mcp-servers/orchestrator/` becomes a Postgres client.** New dependency (`postgres` package, already in workspace). New connection alongside SQLite. `DATABASE_URL` becomes a prerequisite for the orchestrator MCP, not just the store MCP.

- **All four worker agents (`.claude/agents/{brain,brief-writer,content-writer,creative-director}.md`) gain the new tool in frontmatter and a new "write step result before returning" instruction at their emit point.** `creative-director`'s hard rule clarifies: the "never write the store" prohibition applies to the *entity* store (Briefs/Scripts/Variants/etc.), not the orchestrator's step-results store.

- **Loop conductor doctrine simplifies.** `loop.md` §2 spawn: "the worker's final message is `{stepResultId}` — pass it verbatim." §2 fanout: "each worker's final message is `{stepResultId}` — wrap the N refs in an array and pass verbatim." No more "assemble worker outputs" — no surface to drop fields on.

- **No engine.ts changes.** No state.ts changes. No verifier changes. No `stepResult<T>()` consumer changes. The dereference lives entirely at the MCP boundary. The 30-step × 10-verifier blast radius from the orchestrator-engine layer is zero.

- **One ULID per worker output.** ~26 chars + `sr_` prefix. Greppable in logs. Typed-prefix prevents cross-type accidental passes ("did I pass a brief id or a step-result id?").

## Out of scope (this ADR)

- **TTL / cleanup job for `step_results`.** Filed as a follow-up; for v1 we keep rows for the run's lifetime + audit retention.
- **Migrating `runs` + `run_steps` to Postgres.** That's E-030.
- **MCP Resources URI scheme** (`resource://...`). Researched and rejected — opaque IDs in tool args are simpler, identical in effect, don't stretch the spec's intent (Resources are server→client content, not orchestrator→verifier handoff).

## Sources

- [Claim-Check pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/claim-check)
- [Claim Check — Enterprise Integration Patterns Lexicon](https://softwarepatternslexicon.com/enterprise-integration-patterns/message-transformation/claim-check/)
- [Anthropic: How we built our multi-agent research system (Simon Willison's notes)](https://simonwillison.net/2025/Jun/14/multi-agent-research-system/)
- [LangGraph fanout best practices](https://forum.langchain.com/t/best-practices-for-parallel-nodes-fanouts/1900)
- [Google ADK handle pattern](https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)

---

## Update — Superseded by E-034 (2026-05-26)

The storage substrate decisions in this ADR have been superseded by
**E-034 (Sunset SQLite)** and **ADR-025 (Postgres-only)**.
See `docs/decisions/025-postgres-only.md`.

What changed:
- The `step_results` schema is now defined in Drizzle, not raw SQL
  migration files. Runtime behaviour is unchanged.
