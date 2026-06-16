# ADR-024 — Orchestrator-staged worker input

Agent-executable plan for ADR-024.

- **Branch:** `feat/adr-024-spawnprompt-refs` (already created, off `main` at `703f908`).
- **Spec:** `docs/superpowers/specs/2026-05-25-adr-024-orchestrator-staged-input.html`.
- **ADR:** `docs/decisions/024-orchestrator-staged-input.md` (already written; committed alongside this plan in Phase 0).
- **Pattern:** Claim-check pattern applied to input direction (mirror of ADR-022); Memory-handle (Anthropic multi-agent research system); Artifact-handle (Google ADK). Builds on ADR-022 (substrate) and ADR-023 (eager-execute path).

## Phases

Seven phases. Each phase ends with a passing test suite + a clean commit. Order matters because Phase C (engine signature change) is the foundation everything else depends on; do not parallelize.

- [ ] **Phase 0 — ADR + status notes (foundation, no code)**
- [ ] **Phase A — Schema delta (`002_input_refs.sql`) + Postgres migration**
- [ ] **Phase B — `writeStepResult` gains `idempotencyKey` param + tests**
- [ ] **Phase C — `StepSpec.build` signature widens; `BuildContext` lands; engine `plan` becomes async**
- [ ] **Phase D — Refactor P1-fanout via `ctx.stageInput`; update `creative-director.md`; sync agents**
- [ ] **Phase E — Audit P2-render; refactor if needed**
- [ ] **Phase F — Live cold-start walk to HG3; verification scoreboard met**
- [ ] **Phase G — ADR-024 flipped Proposed → Accepted; PR; squash to main**

## Phase 0 — ADR + status notes

- [ ] **Task 0.1.** Confirm `docs/decisions/024-orchestrator-staged-input.md` exists on the branch with `Status: Proposed (2026-05-25)`. Created alongside this plan.
- [ ] **Task 0.2.** Append status notes pointing at ADR-024 as the closing piece of the trilogy on:
  - `docs/decisions/022-claim-check-worker-output.md` — note: ADR-024 mirrors this ADR's mechanism for the input direction (orchestrator → worker via conductor), closing the third transmission boundary.
  - `docs/decisions/023-orchestrator-resident-execution.md` — note: ADR-024 closes the architectural gap left by ADR-023's "spawn / fanout payloads" silence on bulk-input shape.
- [ ] **Task 0.3.** Commit: `docs(adr-024): foundation — ADR + plan + status notes on 022/023`. No code change yet. Tests not run.

## Phase A — Schema delta

The schema delta is additive: nullable column + index. No data backfill needed. Old rows have `payload_kind = NULL` and the unique index permits them (NULLs do not collide).

- [ ] **Task A.1.** Create `packages/orchestrator/src/migrations/postgres/002_input_refs.sql`:
  ```sql
  ALTER TABLE orchestrator.step_results
    ADD COLUMN IF NOT EXISTS payload_kind TEXT;

  CREATE UNIQUE INDEX IF NOT EXISTS step_results_input_idempotency_idx
    ON orchestrator.step_results (run_id, step_id, unit_index, payload_kind)
    WHERE payload_kind IS NOT NULL;
  ```
  The partial index covers only typed rows, leaving legacy untyped rows (output-direction rows pre-ADR-024) untouched.
- [ ] **Task A.2.** Update `packages/orchestrator/package.json` `db:push` script if needed to apply migration 002 alongside 001. Verify:
  ```bash
  pnpm orchestrator:push
  docker exec engineerdad-postgres psql -U engineerdad -d engineerdad \
    -c "\d orchestrator.step_results"
  ```
  Confirm `payload_kind` column + `step_results_input_idempotency_idx` index appear.
- [ ] **Task A.3.** Apply the same migration to `engineerdad_test`. Tests below need the new index.
- [ ] **Task A.4.** Commit: `feat(orchestrator-schema): step_results payload_kind + input-idempotency index (ADR-024 Phase A)`.

## Phase B — `writeStepResult` gains `idempotencyKey`

The persistence function gains an optional knob to switch from fresh-ULID to deterministic-key behaviour.

- [ ] **Task B.1.** Extend `WriteStepResultArgs` in `packages/orchestrator/src/postgres.ts`:
  ```ts
  export interface WriteStepResultArgs {
    runId: string;
    stepId: string;
    unitIndex?: number | null;
    payload: unknown;
    /** Default: a fresh ULID. When set, the row id is derived from
     *  (runId, stepId, unitIndex, payloadKind) — re-calls return the
     *  existing row's id rather than inserting a new one. */
    payloadKind?: string;  // when set, marks this as a kind-tagged row
  }
  ```
- [ ] **Task B.2.** Update the INSERT statement to use `ON CONFLICT (run_id, step_id, unit_index, payload_kind) DO NOTHING RETURNING id` when `payloadKind` is set. For non-kind-tagged rows (existing ADR-022 worker-output behaviour), keep the fresh-ULID insert unchanged. On conflict, follow up with a SELECT to return the existing row id.
- [ ] **Task B.3.** Failing tests, then implementation in `packages/orchestrator/src/postgres.test.ts`:
  - Round-trip with `payloadKind: "input"`: insert returns id, repeat call with same key returns the same id, payload unchanged.
  - Without `payloadKind`: behaviour unchanged from ADR-022 (each call returns a fresh ULID).
  - Re-write with same key but different payload: the existing row's payload wins (we don't overwrite — the idempotency contract says re-plans don't change committed state).
- [ ] **Task B.4.** Build green: `pnpm --filter @engineerdad/orchestrator test`.
- [ ] **Task B.5.** Commit: `feat(orchestrator): writeStepResult idempotencyKey via payload_kind tag (ADR-024 Phase B)`.

## Phase C — `StepSpec.build` async + `BuildContext`

The engine refactor. Touches every stage definition but most stay sync-returning.

- [ ] **Task C.1.** Extend `packages/orchestrator/src/types.ts`:
  ```ts
  export interface BuildContext {
    stageInput(unitIndex: number | null, payload: unknown): Promise<string>;
  }

  export interface StepSpec {
    id: string;
    kind: "spawn" | "fanout" | "write" | "gate";
    build: (run: RunState, ctx: BuildContext) => Promise<Step> | Step;
    verify?: (run: RunState, result: unknown) => VerifyResult;
  }
  ```
- [ ] **Task C.2.** Add `packages/orchestrator/src/build-context.ts`:
  ```ts
  import { writeStepResult } from "./postgres.js";

  export function createBuildContext(runId: string, stepId: string): BuildContext {
    return {
      async stageInput(unitIndex, payload) {
        return writeStepResult({
          runId,
          stepId,
          unitIndex: unitIndex ?? null,
          payload,
          payloadKind: "input",
        });
      },
    };
  }
  ```
- [ ] **Task C.3.** Engine signature change in `packages/orchestrator/src/engine.ts`:
  ```ts
  export async function plan(
    input: { runId?: string; args?: string },
    registry: StageDefinition[],
  ): Promise<PlanResult> {
    // ...
    const ctx = createBuildContext(runId, spec.id);
    return { runId, step: await Promise.resolve(spec.build({ ...run, stage: stage.id }, ctx)) };
  }
  ```
  The `Promise.resolve(...)` wrapper makes the await safe for both sync and async returns. `verify` and `advance` are unchanged (they don't use BuildContext).
- [ ] **Task C.4.** Update every existing stage definition's `build` signature to accept (and ignore) the new `ctx` parameter. Most stages will be a one-line change: `build: (run): Step => ...` → `build: (run, _ctx): Step => ...`. Stage files to touch:
  - `packages/orchestrator/src/stages/tracking.ts`
  - `packages/orchestrator/src/stages/analytics.ts`
  - `packages/orchestrator/src/stages/synthesize.ts`
  - `packages/orchestrator/src/stages/brief.ts`
  - `packages/orchestrator/src/stages/content.ts`
  - `packages/orchestrator/src/stages/produce.ts` (P1 will use `ctx` in Phase D)
  - `packages/orchestrator/src/stages/schedule.ts`
  - `packages/orchestrator/src/stages/experiment.ts`
  - `packages/orchestrator/src/stages/distribute.ts`
  - `packages/orchestrator/src/stages/fixture.ts`
- [ ] **Task C.5.** Update the MCP server's `runEagerLoop` in `mcp-servers/orchestrator/src/eager.ts` — `engine.plan` now returns `Promise<PlanResult>`. The function is already async; `await` the call. Also update the `mcp__orchestrator__plan` handler in `mcp-servers/orchestrator/src/index.ts` similarly.
- [ ] **Task C.6.** Update test fixtures + integration tests across the repo that call `plan(...)` directly:
  - `packages/orchestrator/src/engine.test.ts`
  - `packages/orchestrator/src/engine.integration.test.ts`
  - `packages/orchestrator/src/engine.gate.integration.test.ts`
  - `packages/orchestrator/src/exec.test.ts` (if it touches plan)
  - `mcp-servers/orchestrator/src/eager.test.ts`
  - `mcp-servers/orchestrator/src/integration.test.ts`
  Each call becomes `await plan(...)`.
- [ ] **Task C.7.** Failing test then implementation: add a fixture stage with a fanout whose `build` is async and uses `ctx.stageInput`. Assert (a) the staged payload is in `step_results` with `payload_kind = 'input'`; (b) the returned step's spawnPrompt includes the ref id; (c) re-plan returns the same ref id (idempotency).
- [ ] **Task C.8.** Build green: `pnpm --filter @engineerdad/orchestrator test` + `pnpm --filter @engineerdad/mcp-orchestrator test`. All existing tests pass; new fixture-stage test passes.
- [ ] **Task C.9.** Commit: `feat(orchestrator): StepSpec.build async + BuildContext.stageInput (ADR-024 Phase C)`.

## Phase D — Refactor P1-fanout

Apply the doctrine to the trigger case.

- [ ] **Task D.1.** Inspect `packages/orchestrator/src/stages/produce.ts` P1-fanout — locate where the hook bank is currently inlined into spawnPrompts.
- [ ] **Task D.2.** Refactor P1's `build` to:
  ```ts
  build: async (run, ctx): Promise<Step> => {
    const scripts = approvedScriptsFor(run);
    const units = await Promise.all(
      scripts.map(async (script, i) => {
        const hookBank = hookBankForBrief(run, script.briefId);
        const inputRef = await ctx.stageInput(i, {
          scriptId: script.id,
          briefId: script.briefId,
          hookBank,
        });
        return {
          spawnPrompt: [
            `Run ${run.runId}: you are creative-director in Single-Script worker mode.`,
            `Your FIRST action: call mcp__orchestrator__read_step_result({`,
            `  stepResultId: "${inputRef}"`,
            `}) to fetch your staged input { scriptId, briefId, hookBank }.`,
            `Then call mcp__store__get for the Script and Brief to read full content.`,
            `Operate on EXACTLY ONE Script. Produce 4 distinct CreativeUnits`,
            `(Reel, Feed, YT-Long, Carousel), rotating 4 distinct hooks from the`,
            `staged hook bank across emotional registers. Return`,
            `{ scriptId, creatives: [4 units] } as your final JSON.`,
          ].join("\n"),
        };
      }),
    );
    return { kind: "fanout", stepId: "P1-fanout", worker: "creative-director", units };
  },
  ```
- [ ] **Task D.3.** Update `.claude/agents/creative-director.md`. Add to the agent's §1 First Action:
  ```markdown
  In Single-Script worker mode, your FIRST action is to call
  `mcp__orchestrator__read_step_result({ stepResultId })` with the
  stepResultId from your spawn prompt. The result is `{ scriptId,
  briefId, hookBank }` — the staged input for your unit. Treat this
  as your reference data; do not assume the prompt itself carries it.
  ```
- [ ] **Task D.4.** Update `packages/shared/src/prompts/creative-director.md` (if a prompt fragment lives there) to match. Run `pnpm sync:agents` to propagate.
- [ ] **Task D.5.** Tests:
  - `packages/orchestrator/src/stages/produce.test.ts` — update P1-fanout tests to assert the spawnPrompt contains a `sr_`-prefixed ref and NOT the full hook bank inline. Assert step_results has `payload_kind = 'input'` rows after build.
  - Add a size-budget assertion: each spawnPrompt < 600 bytes (generous margin over the ~280-byte expected size).
- [ ] **Task D.6.** Build green: `pnpm --filter @engineerdad/orchestrator test` + `pnpm sync:agents:check`.
- [ ] **Task D.7.** Commit: `feat(produce): P1-fanout stages hook banks via ctx.stageInput (ADR-024 Phase D)`.

## Phase E — Audit P2-render

P2-render is the suspected second candidate. Audit and refactor only if the per-unit spawnPrompt is structurally inlining bulk.

- [ ] **Task E.1.** Read current P2-render `build` in `produce.ts`. Compute per-unit spawnPrompt size (approximate via the static parts + estimated dynamic substitutions).
- [ ] **Task E.2.** Decision:
  - If per-unit spawnPrompt is < 1 KB and the fanout is < 12 units: no refactor needed; leave as-is. Document the assessment in a comment.
  - Otherwise: refactor using the same shape as P1 (above).
- [ ] **Task E.3.** If refactored: update `.claude/agents/render-worker.md` with the read-on-entry contract.
- [ ] **Task E.4.** Build green.
- [ ] **Task E.5.** Commit: `feat(produce): P2-render audited [+ refactored if needed] (ADR-024 Phase E)`.

## Phase F — Live cold-start walk

Wipe state, drive a fresh cold-start cycle to HG3 under the new contract.

- [ ] **Task F.1.** Restart Claude Code so the rebuilt orchestrator MCP picks up the new exec path.
- [ ] **Task F.2.** Wipe Postgres + SQLite:
  ```bash
  pnpm store:wipe && pnpm store:up && pnpm store:push && pnpm orchestrator:push
  rm -f data/engineerdad.sqlite data/engineerdad.sqlite-shm data/engineerdad.sqlite-wal
  ```
- [ ] **Task F.3.** Cold-mint a run: call `mcp__orchestrator__plan` with no args. Walk through tracking → analytics → synthesize → brief → HG1 auto-approve (4 of N briefs) → C1-fanout → C2-articles → HG2 auto-approve → **P1-fanout (the verification target)** → P2-render → HG3.
- [ ] **Task F.4.** Acceptance checks at HG3:
  - The `plan()` response that returned P1-fanout was < 5 KB total (vs 83 KB pre-ADR-024).
  - Each unit's spawnPrompt was < 400 bytes.
  - Every creative-director worker called `read_step_result` as its first action; the staged input arrived intact.
  - `orchestrator.step_results` has N input rows for P1 (one per unit) with `payload_kind = 'input'`, plus N output rows (the workers' final outputs).
  - Run reached HG3 with conductor tool calls ≤ 30.
  - No "result exceeds maximum allowed tokens" events anywhere in the walk.
- [ ] **Task F.5.** Snapshot the HG3-reached state to `data/snapshots/hg3-adr-024-verification/` (Postgres dump + SQLite copy).
- [ ] **Task F.6.** Commit: `chore(adr-024): cold-start walk verification snapshot at HG3 (ADR-024 Phase F)`.

## Phase G — Flip status, PR, merge

- [ ] **Task G.1.** Flip `docs/decisions/024-orchestrator-staged-input.md` status `Proposed` → `Accepted` with a 2026-05-25 status note quoting the cold-walk verification artefact.
- [ ] **Task G.2.** Update TASKS.md status block: mark E-034 as resolved (closed by ADR-024). Move E-034 entry into DONE.md if convention requires (check `DONE.md` style).
- [ ] **Task G.3.** Commit: `docs(adr-024): Accepted; close E-034`.
- [ ] **Task G.4.** Push branch + open PR titled `feat(adr-024): orchestrator-staged worker input via step_result refs`. Description quotes the ADR's Decision section + links the spec + the cold-walk verification artefact.
- [ ] **Task G.5.** Squash-merge to `main` on review approval. The phase-tagged commits become the squash body.

## Out of scope (not in this plan)

- TTL / cleanup job for `step_results` input rows — filed alongside ADR-022's TTL task.
- Cross-run input refs — out of scope; would need its own ADR.
- Worker → worker direct refs — out of scope.
- Encryption-at-rest for staged input — same posture as entity rows; no change.

## Verification scoreboard (Phase F gate)

| Metric | Today | After ADR-024 (acceptance) |
|---|---|---|
| P1-fanout `plan()` response size | 83,795 bytes (cap-blown) | < 5 KB |
| Per-unit P1 spawnPrompt size | ~7,200 bytes | < 400 bytes |
| Cold-start cycle reaches HG3 | blocked at P1-fanout | HG3 reached, no cap events |
| Conductor tool calls (4-brief flow, cold start to HG3) | N/A (blocked) | ≤ 30 |
| step_results rows per fanout | N (output only) | 2N (input + output), input rows idempotent across re-plans |
| Re-plan during dispatch window writes duplicate input rows | (N/A) | 0 duplicates (idempotency key + DB unique index) |
| Tests | ~555 passing | ~565+ passing, no regressions |
