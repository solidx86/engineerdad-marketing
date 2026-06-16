# 023 — The conductor is a reasoning surface; the orchestrator owns execution

**Status:** Accepted (2026-05-25)

> **Status note (2026-05-25):** Verified end-to-end on two live walks. Resume walk: `run_1779611092` reached HG3 in one `plan()` call (P3-persist's 16 store.create eager-executed inside the orchestrator). Cold-start walk: `run_1779670351` drove tracking → analytics → synthesize → brief → content through HG2 with zero write-step MCP calls reaching the conductor. A separate orchestrator→conductor cap surface was surfaced at P1-fanout's spawnPrompt envelope (bulk worker INPUT data, 83 KB across 12 units). That boundary is orthogonal to this ADR's scope and is filed as **E-034 / ADR-024** ("spawnPrompt cap via step_result refs") — same substrate, mirror direction. This ADR's doctrine stands as written.

> **Status note (2026-05-25, drafted same day):** ADR-024 has been drafted on `feat/adr-024-spawnprompt-refs`. It closes the architectural gap left by this ADR's silence on spawn/fanout *payload* shape. This ADR named the conductor's surface as "spawn / fanout / terminal-gate / done / halt only"; ADR-024 specifies that the spawn/fanout payloads themselves carry thin task contracts + a `stepResultId` ref to bulk input data, not inlined bulk. The `StepSpec.build` signature widens from sync to `Promise<Step> | Step` and gains a `BuildContext` capability — both backward-compatible (the engine awaits unconditionally; existing sync builds still work). ADR-023 is unaffected; ADR-024 is additive.

**Source:** `docs/superpowers/specs/2026-05-24-adr-023-orchestrator-resident-execution.html`. The spec is the design rationale and the worked examples; this ADR is the doctrine the spec implements.

**Generalizes:** ADR-005 (thin-adapter / no-MCP-mesh), ADR-018 (mechanical routing), ADR-022 (claim-check / Reference-Based Messaging). Status notes appended to each of the above pointing at this ADR as the umbrella.

## Context

ADR-022 (Accepted 2026-05-24) solved one specific cap exposure: worker output flowing back through the conductor's inline tool-call channel. Workers now persist their full output to `orchestrator.step_results` and emit a 50-byte `{stepResultId}` ref; the conductor carries refs verbatim; the orchestrator MCP dereferences server-side before calling the engine. That fixed the boundary where bulk leaves a worker and enters the conductor.

Hours after ADR-022 landed, `run_1779611092` advanced past HG2 into the produce stage and hit a different cap at a different boundary. P3-persist's `plan()` response embedded sixteen `mcp__store__create` calls, each with ~14 KB of `props` (dual-language shotlists, ad copy, targeting JSON). The orchestrator MCP's response weighed **238,164 bytes** — the conductor's harness intercepted it with `result exceeds maximum allowed tokens` and persisted it to disk. The conductor could not see the calls it was supposed to execute.

The same cap, a different tributary. ADR-022's text covers worker → conductor (one direction); the new bug is orchestrator → conductor (the opposite direction). ADR-022's *principle* covers both; its *mechanism* covers only the first. The system is exhibiting a deeper pattern: **the conductor is the cap-sensitive transmission stop wherever bulk crosses it**, and we keep finding new tributaries that feed it.

Research (see SPEC §3) established that this is solved across mature workflow engines under two named family-patterns: **claim-check at the new boundary** (Temporal External Storage, Argo artifacts, ADK handles), and **direct service integration** where the executor never sees the work-order at all (AWS Step Functions Direct Service Integrations, Temporal activities, Anthropic's multi-agent memory-handle, LangGraph state-slicing). The published consensus is uniform: **the LLM should be present at decision points, not at transport points. Mechanical fan-out of pre-decided writes is a transport point.** No published pattern recommends pushing bulk through an LLM's tool-call channel.

We have three doctrines in this repo that have all been instantiating one underlying principle:

- **ADR-005** — MCP servers are thin adapters over `packages/`, and they don't open client connections to each other ("no-MCP-mesh"). The principle: don't make MCP servers gossip with each other; route through libraries.
- **ADR-018** — distribution is a pure mechanical router that must never derive copy / targeting / metadata at call time. The principle: don't make the conductor decide mechanical things.
- **ADR-022** — workers persist outputs; conductor carries refs; orchestrator dereferences. The principle: don't make the conductor carry bulk worker outputs.

These all say the same thing, narrower or wider depending on the case at hand. We name the unified principle now and apply it uniformly going forward.

## Decision

**The conductor is a reasoning surface — not a transmission surface, not an execution surface.**

The conductor's job is to dispatch reasoning workers (`spawn` / `fanout`) and to honour human gates. Mechanical work that requires no reasoning belongs inside the orchestrator. Bulk that requires no inspection belongs on the side of the boundary that already holds it.

Concretely:

- **The conductor only ever talks to two surfaces.** `mcp__orchestrator__*` (for state + work delegation) and `Task` (Claude Code's built-in for spawning subagent workers, which the orchestrator cannot invoke itself). Nothing else — not `store`, not `meta-ads`, not `analytics`, not `corpus`, not `youtube`, not `heygen`. Those are reached by the orchestrator via in-process library imports, or by spawned workers via their own MCP access. Never by the conductor directly.

- **The orchestrator MCP imports `packages/<name>/` libraries to execute write steps in-process.** It does not open MCP client connections to other servers (ADR-005 holds; the library import is a same-process call, not a mesh edge). For each MCP server whose business logic is needed inside the orchestrator, that logic is first extracted to `packages/<name>/`; the existing MCP server then becomes the canonical 30-line thin adapter over the package.

- **Eager execution.** When the orchestrator's `plan()` handler encounters a write step it can self-execute, it does so immediately and inline within the same `plan()` call. It calls `engine.advance()` itself, then advances through any subsequent self-executable steps in a tight loop. It returns control to the conductor only when the next step requires the conductor — `spawn`, `fanout`, `gate-stop` (no automated check, or check failed), `done`, or `halt`.

- **Verify folds into advance.** Since the orchestrator both runs the work and persists the result, there is no second tool call where the conductor could re-shape the result between verify and advance. The engine's verifier runs inside the same orchestrator MCP turn that captured the work.

- **Spawn / fanout transmission keeps ADR-022's claim-check pattern.** Workers persisting their own outputs and returning refs is unchanged. ADR-023 does not generalize that mechanism to the orchestrator → conductor direction — instead it eliminates the need by ensuring no bulk crosses that boundary at all.

## Scope of the rollout (Scope C)

Total alignment. Every `mcp-servers/<name>/src/` whose business logic the orchestrator needs to invoke is extracted into a sibling `packages/<name>/src/`. The MCP server in each case becomes the canonical ADR-005 thin adapter.

Extraction order (per SPEC §8.1):

1. `analytics` — most write-step traffic; couples with E-030's eventual Postgres migration.
2. `corpus` — small read-mostly surface; quick win.
3. `meta-ads` — second-largest surface; HTTP + PII handling.
4. `experiment` — small, pure logic.
5. (`youtube` and `heygen` deferred until a write step actually needs them from the orchestrator side.)

Order 1–4 covers every write step in `LIVE_REGISTRY` today.

## Architectural consequences

- **Conductor's `/loop` contract shrinks.** Today's `write` and `gate` (with check) branches in `loop.md` become obsolete — the conductor never sees those step kinds after ADR-023. The conductor's loop reduces to: call `plan()`; if the result is `spawn` / `fanout`, dispatch via `Task` and pass refs to `advance()`; if `gate-stop` / `done` / `halt`, print the message and stop. The `$<label>` capture syntax and per-call dispatch logic disappear from the doc.

- **Engine and verifiers are unchanged.** `packages/orchestrator/src/engine.ts` and the existing `packages/orchestrator/src/verifiers/*.ts` continue to do exactly what they do today. A new `executeWriteStep(step, deps)` function in `packages/orchestrator/src/exec.ts` is the only logic addition; it walks `step.calls[]`, dispatches each `{tool, args}` to the right package function via a table-driven map, and returns the array of results.

- **Compliance scanner remains the entity-write choke point.** The scanner (`packages/shared/compliance`) is imported as a library and called inside `executeWriteStep` on every entity-write payload. The PerformanceReports exemption (recorded in ADR-022 §"Compliance scanner remains the entity-write choke point") is preserved as a single feature flag on the scanner call.

- **No new MCP servers or tools.** The orchestrator MCP gains no new tools — only its existing `plan` handler gains internal eager-execute behaviour. `write_step_result` and `read_step_result` (added by ADR-022) remain in force for spawn / fanout payloads, unchanged.

- **Outside callers retain the MCP surface.** The `meta-ads`, `analytics`, `corpus`, `experiment`, `youtube`, and `heygen` MCP servers continue to expose the same stdio tools to Claude Code's main session, future scheduled runners, Cowork, etc. The extraction moves the *business logic* into `packages/`; the *protocol surface* the servers expose is preserved.

- **Fallback for unpackaged deps.** If a future write step references a tool whose package the orchestrator hasn't imported, `executeWriteStep` returns the legacy lazy shape `{kind:"write", executed:false, calls:[...]}` and the conductor's old branch executes it. The fallback is a smell — every firing files a follow-up to package the dep — but it preserves end-to-end function during the rollout.

## What this supersedes

- **The `write`-kind branch of `.claude/commands/loop.md`'s §2 Execute clause** is removed. Substitution rules (`$<label>` capture) are removed. The verify/advance two-step for write kind is removed.

- **The "honour-system never-reshape" rule** (which ADR-022 partially superseded for spawn/fanout) is now fully structurally enforced for all step kinds the conductor can touch.

## What this resolves

- The 238 KB plan-envelope cap exposure found on `run_1779611092` P3-persist (2026-05-24). After ADR-023, P3-persist's 16 entity-writes execute entirely inside the orchestrator MCP turn that serves `plan()`; the conductor never sees the calls.

- The growing class of "the conductor wastes round-trips to transmit mechanical work" — collapses to a single `plan()` round-trip per write step (or zero, in the eager-loop case, when several writes chain).

- The architectural ambiguity in ADR-018: distribution was singled out as "the mechanical router," but every other mechanical write step in the loop had the same shape and the same conductor-in-the-middle posture. ADR-023 makes the rule general.

## Doctrine — default thin, opt-out only when reasoning is required

The conductor is structurally constrained to a thin role. Reasoning use cases (the conductor judging across multiple workers' outputs, retrying with awareness, meta-orchestration) continue to be possible via the `mcp__orchestrator__read_step_result` tool added by ADR-022 — that escape hatch remains. But mechanical work and bulk transmission are no longer the conductor's responsibility.

This matches the published industry consensus:

- **Anthropic's multi-agent research system** — lead agent saves the plan to memory; subagents receive only objective + output format + boundaries.
- **AWS Step Functions** — direct service integrations let the state machine invoke services without marshalling through any client.
- **Temporal** — activities are dispatched by the workflow itself; the workflow code is the orchestrator.
- **LangGraph** — explicit doctrine that large artifacts stay out of graph state.

## Out of scope (deliberate)

- **E-033 — critic / evaluator step pattern.** ADR-023 is about *who holds and runs work*. E-033 is about *who judges output quality*. Independent axis. Composes with ADR-023 but does not block or get blocked by it.

- **E-030 — SQLite → Postgres unification.** Independent axis. The analytics-package extraction (Scope C step 1) is structured to make E-030 local, but the migration itself is its own ADR.

- **Cross-MCP-mesh.** Considered and rejected on ADR-005 grounds. The package-extraction route preserves ADR-005's no-mesh rule.

- **Plan-ref pattern (the worker-output claim-check, generalized to plans) as a fallback.** Not built. If a future case emerges where the orchestrator needs to ship a plan envelope to a non-conductor outside caller (e.g., a remote scheduler), this can be added then. For the conductor-only case ADR-023 supersedes the need.

## Migration impact

`run_1779611092` is paused at P3-persist with all upstream state preserved (`orchestrator.step_results` carries 11 clean JSONB rows through P2-render). After ADR-023 ships, the run resumes by calling `/loop` once: the conductor's single `plan()` invocation triggers the orchestrator's eager-execute loop, which runs P3-persist's 16 entity writes, advances the engine, reaches HG3, and returns the gate-stop message. No state migration, no schema change. The wedged run becomes the verification artifact for the new contract.

## References

The spec at `docs/superpowers/specs/2026-05-24-adr-023-orchestrator-resident-execution.html` contains the worked examples, the boundary inventory, the industry-pattern research, the package-extraction prework table, and the risk register. The plan at `docs/superpowers/plans/2026-05-24-adr-023-orchestrator-execution.md` is the agent-executable rollout (created alongside this ADR).
