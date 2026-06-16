# 024 — The orchestrator stages worker input; spawnPrompts carry refs

**Status:** Accepted (2026-05-25)

**Source:** `docs/superpowers/specs/2026-05-25-adr-024-orchestrator-staged-input.html`. The spec is the design rationale and the worked examples; this ADR is the doctrine the spec implements.

> **Status note (2026-05-25, verification):** Implementation landed across Phases A–E and was verified end-to-end on `run_1779696355` — a fresh cold-start cycle minted against a wiped Postgres + SQLite. The run reached HG3 cleanly with the new contract. P1-fanout's `plan()` envelope dropped from 83,795 bytes (cap-blown pre-ADR-024) to ~2.5 KB; per-unit `spawnPrompt` sizes settled at ~520 bytes (P1) and ~470 bytes (P2-render), down from 7,200 / 2,000–5,000 bytes inlining bulk. The `orchestrator.step_results` table held 4 input + 4 output rows for P1-fanout and 8 + 8 for P2-render — the canonical 2N pattern. 12/12 worker spawns used `read_step_result` as their first action and received intact staged input. No "result exceeds maximum allowed tokens" events anywhere in the walk. Snapshot at `data/snapshots/hg3-adr-024-verification/`.

**Builds on:** ADR-022 (claim-check / Reference-Based Messaging — provides the substrate) and ADR-023 (orchestrator-resident execution — provides the eager-execute path). Status notes appended to both pointing at this ADR as the closing piece.

## Context

ADR-022 fixed one cap-sensitive transmission boundary (worker → conductor output): workers persist their full output to `orchestrator.step_results` and emit a 50-byte `{stepResultId}` ref; the conductor carries the ref verbatim. ADR-023 closed a second (orchestrator → conductor output, in the write-step direction): the orchestrator self-executes write steps via library imports of `packages/<name>`; the conductor never sees `step.calls[]` at all.

Hours after ADR-023 landed and was verified end-to-end on `run_1779611092`, the Phase H.4 cold-start walk on a new run (`run_1779670351`) drove tracking → analytics → synthesize → brief → content cleanly through HG2 and hit a third cap surface at P1-fanout. The orchestrator's `plan()` response for P1 carried 12 fanout units, each `spawnPrompt` embedding the brief's full hook bank (~30 bilingual hooks ≈ 7 KB per unit). The total response weighed **83,795 bytes / 46 lines**:

```
Error: result (83,795 characters across 46 lines) exceeds maximum allowed tokens.
Tool: mcp__orchestrator__plan
```

This is the same cap. It is at a third boundary: **orchestrator → conductor, on the input direction.** The orchestrator generates per-unit reference data for spawned workers; that data crosses the conductor's transmission channel on its way to `Task` dispatch.

ADR-022 covers worker → conductor (output). ADR-023 covers orchestrator → conductor (output of mechanical work). ADR-024 closes the trilogy by covering orchestrator → conductor (input to spawned workers).

The three together instantiate one unified rule: **bulk data never passes through the conductor's tool channel.** The conductor carries references; bulk lives in `orchestrator.step_results`. ADR-024 names the rule and closes the last open direction.

Research (see SPEC §3) confirms the convergence is industry-wide. Anthropic's multi-agent research system saves the LeadResearcher's plan to a persistent Memory store before dispatching subagents — the subagent prompts don't carry the full plan, they carry the agreement that the plan exists and can be read. Google ADK formalizes this as the artifact_service with `save_artifact(filename, data)` / `load_artifact(filename)`. Claude Code's own subagent documentation warns that *"every token in the prompt is paid for whether the subagent references it or not"* and recommends thin prompts with on-demand fetches. We are in good company.

## Decision

**When a stage step's `build()` constructs a fanout (or spawn) whose units require bulk per-unit reference data, the orchestrator stages that data to `orchestrator.step_results` at construction time and embeds only the `stepResultId` ref in each `spawnPrompt`. Spawned workers call `mcp__orchestrator__read_step_result` on entry to fetch their staged input.**

Concretely:

- **`StepSpec.build` signature widens.** Today's `build: (run: RunState) => Step` becomes `build: (run: RunState, ctx: BuildContext) => Promise<Step> | Step`. The engine's `plan()` becomes async and awaits unconditionally. Stages that don't need staging keep returning sync values; the union accepts both.

- **`BuildContext` is the only effectful capability `build()` gains.** It exposes one method: `stageInput(unitIndex, payload): Promise<string>` — writes the payload to `orchestrator.step_results` under a deterministic key and returns the `stepResultId` to embed in a `spawnPrompt`. No other capability is exposed.

- **Idempotency by deterministic key.** The row id is derived from `(runId, stepId, unitIndex, payload_kind)` rather than a fresh ULID for staging writes. Re-planning during the dispatch window finds the existing row and returns its id; re-planning after the fanout's `advance` doesn't re-enter `build()` at all. The combination is at-most-once-effectively even though `build()` does writes.

- **Worker contract** (codified in agent prompts): *first action on entry* is `mcp__orchestrator__read_step_result({ stepResultId })` to fetch staged input. The bulk data is never assumed to be in the prompt itself.

- **No new MCP tools, no new step kind.** ADR-024 reuses the existing `step_results` substrate, the existing `write_step_result` and `read_step_result` tools, the existing ref shape. The only schema delta is an optional `payload_kind` column (nullable text, defaults null) on `step_results` to tag rows as `"input"` vs `"output"` for audit clarity and a future TTL policy, plus a unique index on `(run_id, step_id, unit_index, payload_kind)` to enforce idempotency at the DB layer.

## Doctrine — what `build()` is allowed to do

Making `build()` async unlocks I/O at step-construction time. The discipline is explicit:

**Allowed inside `build()`:**
- Writing to `orchestrator.step_results` via `ctx.stageInput` (the only capability `BuildContext` exposes).
- Reading from `orchestrator.step_results` for prior staged inputs in the same run (via the existing `stepResult<T>()` helper — read of the persisted step result is sync from cached state).
- Pure computation: shaping prompt text, deriving labels, computing identities, filtering / mapping over `run` state.

**Not allowed inside `build()`:**
- Calling other MCP servers (would violate ADR-005's no-MCP-mesh rule).
- Writing entity rows (Briefs, Scripts, CreativeVariants, etc.) — entity writes happen in `write` steps, which run through the compliance scanner. `build()` does not bypass that choke point.
- Calling external APIs (Meta, OpenAI, Anthropic) — those are step-execution work, not step-construction.
- Causing any observable run-state change beyond the one staging write.

The single allowed write is auditable (every entry in `step_results` carries `run_id`, `step_id`, `unit_index`, `size_bytes`, `created_at`), addressable via the existing `read_step_result` tool, and constrained in size by application convention. The discipline keeps `build()` from becoming a place where arbitrary side effects accumulate while opening exactly enough room for the staging pattern.

## Scope of the rollout

P1-fanout in the produce stage is the primary trigger. P2-render likely needs the same treatment (audited during Phase E). Other current stages (S1, B1, C1, C2) already construct thin spawnPrompts that carry only ids; they are unaffected by ADR-024 (the type signature widens but their `build` functions remain sync-returning).

The rollout shape:

1. Schema delta — `002_input_refs.sql` migration adds `payload_kind` + the unique index.
2. `writeStepResult` gains an `idempotencyKey` param (default fresh-ULID; staging calls pass deterministic keys).
3. Engine signature change — `StepSpec.build` widens to `Promise<Step> | Step`; `plan()` becomes async.
4. P1-fanout refactor — `produce.ts` uses `ctx.stageInput`; `creative-director.md` gains the read-on-entry contract.
5. P2-render audit + refactor if needed.
6. Live walk verification — re-attempt the cold-start cycle, reach HG3.

## Architectural consequences

- **Engine `plan()` becomes async.** `Promise<{ runId, step }>` return type ripples through the `mcp-servers/orchestrator` MCP handler — already async since ADR-023 Phase B, so no further changes there. Test fixtures that called `plan(...)` synchronously now await.

- **No new step kinds.** Considered and rejected: a `materialize` step kind that pre-stages refs in a separate engine step. Rejected because it conflates "data the run state needs to track as completed work" with "data the orchestrator needs to materialize on the way to dispatching a fanout." The latter is an implementation detail of building a fanout, not a separate logical step.

- **No new MCP tools.** Considered and rejected: a hypothetical `stage_input` MCP tool the orchestrator MCP would call out to. Rejected because it would either (a) re-introduce MCP-mesh against ADR-005, or (b) require the orchestrator to call its own tool surface, which is pointless when the underlying `writeStepResult` function is already in-process.

- **Compliance scanner unaffected.** Staged inputs are not entity rows; they don't pass through the scanner. The scanner remains the entity-write choke point at the `packages/store/src/crud.ts` boundary (per ADR-022 §"Compliance scanner remains the entity-write choke point"). This is correct: staged input is intermediate orchestrator data, not marketing artifact subject to regulator rules.

- **TTL / cleanup policy expands.** ADR-022's filed-but-unscoped TTL task gains a new dimension: input-kind rows are aggressively GC-able (immediately after the fanout's `advance` lands), whereas output-kind rows have longer retention. The `payload_kind` column makes the policy tractable. The actual TTL implementation remains a follow-up to ADR-022; ADR-024 just specifies the lifecycle bound.

## What this resolves

- The 83 KB cap exposure surfaced on `run_1779670351` P1-fanout (2026-05-25). After ADR-024, P1-fanout's `plan()` response drops to ~3.4 KB (12 units × ~280 bytes each).

- The latent inline-bulk shape in any other fanout that grows per-unit input data over time. The pattern is now structurally bounded: thin spawnPrompts + ref-fetched bulk.

- The architectural gap left by ADR-023. ADR-023 explicitly named the conductor's surface as "spawn / fanout / terminal-gate / done / halt only" — but did not say what shape those spawn/fanout payloads should take. ADR-024 closes that: thin task contract + ref.

## Doctrine — default thin spawnPrompts, opt-in staging

A spawnPrompt's default content is the four ingredients Anthropic's multi-agent research system identified as load-bearing: **objective, output format, tool guidance, task boundaries.** Plus any unique-per-unit ids the worker needs as handles (script id, brief id, run id). Plus — if and only if the unit needs bulk reference data — a single `stepResultId` ref pointing at the staged input.

Stages whose workers need no bulk reference data (most spawn steps, simple fanouts) write nothing during `build()` and return sync values. Stages whose workers do need bulk (P1-fanout today, P2-render likely) opt into staging by calling `ctx.stageInput`. The opt-in is per-stage and per-fanout-unit; no global mode change.

## What stays unchanged

- **The substrate.** `orchestrator.step_results` table, JSONB payload column, `sr_`-prefixed ULID ids. Input rows live in the same table as output rows; the `payload_kind` column distinguishes them.

- **The conductor's surface.** `loop.md` doesn't change. The conductor still sees `spawn / fanout / terminal-gate / done / halt`; it still dispatches workers via `Task` and passes refs to `verify` / `advance`. The change is invisible to the conductor — spawnPrompts just become smaller.

- **Worker output protocol.** ADR-022 unchanged. Workers still persist outputs to `step_results` and return `{stepResultId}`.

- **Eager-execute path.** ADR-023 unchanged. The orchestrator still self-executes write steps and gate-checks inside `plan()`. The async signature widening is in `StepSpec.build`, not in the eager-execute loop (which was already async).

- **Verify / advance contract.** Unchanged.

## Out of scope (deliberate)

- **TTL / cleanup job for `step_results`.** Filed as a follow-up alongside ADR-022's TTL task. ADR-024 specifies the lifecycle bound (input rows GC-able after advance; output rows longer retention); the job itself is its own task.

- **Cross-run input refs.** A future stage might want to stage data once and reuse across runs. Not in scope. Would need its own ADR.

- **Worker → worker direct refs.** Workers today don't read each other's outputs directly. ADR-024 doesn't open that door.

- **Encryption-at-rest for staged input.** Same Postgres, same encryption posture as entity rows. Not scoped here.

- **Promoting `build()` to general-purpose I/O.** The discipline section explicitly forbids it. Future capability expansions require an ADR amendment.

## Migration impact

The cold-start cycle on `run_1779670351` is paused before P1-fanout (we read the saved tool-result file rather than driving past the cap). After ADR-024 ships, a fresh cold-start cycle is started; tracking → analytics → synthesize → brief → content → produce drives through HG3 cleanly under the new contract. The wedged dispatch state is not recovered (no need — the C1-fanout outputs and HG2 approvals can be re-derived from a fresh run faster than salvaging the existing one).

`run_1779670351` itself becomes a documented verification artifact for the bug; the new cold start becomes the verification artifact for the doctrine.

## References

The spec at `docs/superpowers/specs/2026-05-25-adr-024-orchestrator-staged-input.html` contains:
- The worked example showing P1-fanout before (83 KB) vs after (~3.4 KB).
- The boundary inventory table showing how ADR-022, ADR-023, and ADR-024 together cover the three transmission directions.
- The industry-precedent research (Anthropic Memory, Google ADK artifacts, Claude Code subagent docs, LangGraph, Airflow XCom).
- The phase-by-phase implementation plan.
- The verification scoreboard and risk register.

The plan at `docs/superpowers/plans/2026-05-25-adr-024-orchestrator-staged-input.md` is the agent-executable rollout (created alongside this ADR).

External references:
- Anthropic — How we built our multi-agent research system (Simon Willison's notes, 2025-06-14).
- Google ADK — Artifacts & artifact_service (`google.github.io/adk-docs/artifacts/`).
- Claude Code — Subagent token-cost guidance (`code.claude.com/docs/en/sub-agents`).
- Hohpe — Enterprise Integration Patterns: Claim Check (the root pattern, here applied mirrored).
