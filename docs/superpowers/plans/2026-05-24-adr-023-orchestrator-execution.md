# ADR-023 — Orchestrator-resident execution

Agent-executable plan for ADR-023.

- **Branch:** `feat/adr-023-orchestrator-execution` (already created, off `main` at `e00d606`).
- **Spec:** `docs/superpowers/specs/2026-05-24-adr-023-orchestrator-resident-execution.html`.
- **ADR:** `docs/decisions/023-orchestrator-resident-execution.md` (already written; committed alongside the first phase of this plan).
- **Pattern:** Direct Service Integration (AWS Step Functions vocabulary) + planner-executes (Anthropic / Temporal vocabulary). Generalizes ADR-005, ADR-018, ADR-022.

## Phases

Eight phases. Each phase ends with a passing test suite + a clean commit. The phases are *graduations* — each one moves another tool family from "conductor executes via MCP" to "orchestrator executes via library import." Order matters because later phases compound on earlier ones; do not parallelize.

- [ ] **Phase 0 — ADR + status notes (foundation, no code)**
- [ ] **Phase A — `packages/orchestrator/src/exec.ts` + `ExecDeps` skeleton (no real deps yet)**
- [ ] **Phase B — Wire eager-execute into the orchestrator MCP `plan()` handler (store-only graduate)**
- [ ] **Phase C — Update `.claude/commands/loop.md` for the new contract**
- [ ] **Phase D — Extract `packages/analytics`; graduate A1 / A2 / A3 / T2-partial**
- [ ] **Phase E — Extract `packages/corpus`; graduate any corpus-touching write step (none currently, future-proof)**
- [ ] **Phase F — Extract `packages/meta-ads`; graduate T1 / T2-Meta**
- [ ] **Phase G — Extract `packages/experiment`; complete `LIVE_REGISTRY` coverage**
- [ ] **Phase H — Live walk verification + PR**

## Phase 0 — ADR + status notes

- [ ] **Task 0.1.** Confirm `docs/decisions/023-orchestrator-resident-execution.md` exists on the branch (already written 2026-05-24 alongside this plan). Flip its `Status:` line from `Draft` to `Proposed` (it becomes `Accepted` when Phase H lands).
- [ ] **Task 0.2.** Confirm status notes are appended on:
  - `docs/decisions/005-mcp-architecture.md`
  - `docs/decisions/018-spec-build-vs-routing.md`
  - `docs/decisions/022-claim-check-worker-output.md`
- [ ] **Task 0.3.** Commit: `docs(adr-023): foundation — ADR + status notes on 005/018/022`. No code change yet. Tests not run.

## Phase A — `packages/orchestrator/src/exec.ts` + `ExecDeps` skeleton

The executor is the new logic addition. Built test-first, against a fixture-stage write step that uses a single in-package dep (the simplest possible: `packages/store`).

- [ ] **Task A.1.** Create the type surface in `packages/orchestrator/src/exec.types.ts`:
  ```ts
  export interface ExecDeps {
    store:      typeof import("@engineerdad/store");
    compliance: typeof import("@engineerdad/shared").complianceScan;
    // analytics, metaAds, corpus, experiment fields added in later phases
  }
  export type ExecResult = unknown[]; // mirrors today's conductor result array
  ```
- [ ] **Task A.2.** Build the dispatch table in `packages/orchestrator/src/exec.dispatch.ts`. Table-driven: map `tool` string → handler function that pulls args, calls the right `deps.*` function. For Phase A, populate only the `mcp__store__*` rows. Other rows return `unsupported` (forces the fallback path in Phase B).
  ```ts
  const TABLE: Record<string, (args, deps) => Promise<unknown>> = {
    "mcp__store__create":    (a, d) => d.store.create(a.entity, a.props),
    "mcp__store__query":     (a, d) => d.store.query(a.entity, a.filter, a.fields),
    "mcp__store__get":       (a, d) => d.store.get(a.entity, a.id),
    "mcp__store__update":    (a, d) => d.store.update(a.entity, a.id, a.props),
    "mcp__store__set_status":(a, d) => d.store.setStatus(a.entity, a.id, a.status),
  };
  ```
- [ ] **Task A.3.** Build `executeWriteStep(step, deps)` in `packages/orchestrator/src/exec.ts`. Walks `step.calls[]`, looks up each `tool` in the table, calls the handler, accumulates results. If a tool is missing from the table, throws `UnsupportedToolError`. Substitution-arg syntax (`$<label>`) handled the same way today's `loop.md` documents — though for write steps the orchestrator now owns the substitution.
- [ ] **Task A.4.** Build `executeCheck(check, deps)` — same shape but for the single read call inside a `gate` step's `check` clause.
- [ ] **Task A.5.** Failing tests, then implementation:
  - `packages/orchestrator/src/exec.test.ts` — unit tests with mocked `deps`: happy path for each tool in the table; missing-tool error; substitution-arg test; compliance-scan invocation count assertion.
  - `packages/orchestrator/src/exec.integration.test.ts` — runs against live Postgres `engineerdad_test`. Fixture stage with one write step containing 3 `mcp__store__create` calls. Asserts: 3 rows persisted; compliance scanner called 3 times; returned results array has 3 `{id}` entries.
- [ ] **Task A.6.** Build green: `pnpm --filter @engineerdad/orchestrator test`. All 207-ish existing tests still pass; new tests pass.
- [ ] **Task A.7.** Commit: `feat(orchestrator): executeWriteStep + executeCheck (store-only dispatch)`.

## Phase B — Wire eager-execute into the orchestrator MCP `plan()` handler

The orchestrator MCP server is where the new behaviour becomes observable. `plan()` gains an internal loop that runs through self-executable steps before returning.

- [ ] **Task B.1.** Modify `mcp-servers/orchestrator/src/index.ts`:
  - Import `executeWriteStep`, `executeCheck`, `UnsupportedToolError` from `@engineerdad/orchestrator`.
  - Construct a singleton `ExecDeps` at startup: `{ store: <import @engineerdad/store>, compliance: <import @engineerdad/shared>.complianceScan }`. (Other deps undefined for now; missing-key triggers `UnsupportedToolError` and falls back.)
- [ ] **Task B.2.** Wrap the existing `plan` tool handler with the eager-execute loop:
  ```ts
  server.tool("plan", "...", PlanInputSchema.shape, async (args) => {
    const runId = ensureRunId(args.runId);
    while (true) {
      const step = engine.plan({ runId }, LIVE_REGISTRY);
      if (isConductorRelevant(step)) return toolResult({ runId, step });

      try {
        if (step.kind === "write") {
          const results = await executeWriteStep(step, EXEC_DEPS);
          engine.advance(runId, step.stepId, results, LIVE_REGISTRY);
        } else if (step.kind === "gate" && step.check) {
          const checkResult = await executeCheck(step.check, EXEC_DEPS);
          const v = engine.verify(runId, step.stepId, checkResult, LIVE_REGISTRY);
          if (!v.ok) return toolResult({ runId, step: makeGateStop(step) });
          engine.advance(runId, step.stepId, checkResult, LIVE_REGISTRY);
        }
      } catch (e) {
        if (e instanceof UnsupportedToolError) {
          // fallback: return the step inline so the conductor executes the old way
          return toolResult({ runId, step });
        }
        return errorResult(e);
      }
    }
  });
  ```
- [ ] **Task B.3.** `isConductorRelevant(step)` predicate returns true for `spawn`, `fanout`, `gate-stop`, `done`, `halt`. False for `write`, `gate-with-check` (those continue the loop).
- [ ] **Task B.4.** `makeGateStop(step)` synthesizes a `kind:"gate-stop"` step from a `kind:"gate"` whose check failed, preserving message + stepId so the conductor STOPs with the right context.
- [ ] **Task B.5.** Failing tests, then implementation:
  - `mcp-servers/orchestrator/src/index.test.ts` (new) — exercises the wrapped handler against the fixture registry:
    - write step with all store calls → loops past it, returns next conductor-relevant step;
    - write step with unsupported tool → fallback path, returns the inline step;
    - gate-with-check that passes → loops past;
    - gate-with-check that fails → returns gate-stop;
    - spawn / fanout → returns verbatim.
  - `mcp-servers/orchestrator/src/integration.test.ts` (extend existing) — end-to-end against live Postgres + the live registry's content / produce stages. C0-briefs and P3-persist (when the run state has approved scripts) should both pass through eagerly.
- [ ] **Task B.6.** Build green: `pnpm --filter @engineerdad/mcp-orchestrator test`. All existing tests still pass.
- [ ] **Task B.7.** Commit: `feat(mcp-orchestrator): eager-execute write/gate-check inside plan() handler`.

## Phase C — Update `.claude/commands/loop.md`

The conductor's contract narrows. The doc must match.

- [ ] **Task C.1.** Remove the `case "write":` branch from §2 Execute. Replace with a single line: *"Write steps are executed inside `plan()` by the orchestrator and never surface here. See ADR-023."*
- [ ] **Task C.2.** Remove the `$<label>` substitution-rule paragraph from the same section (no longer the conductor's concern).
- [ ] **Task C.3.** Modify the `case "gate":` branch: only the no-`check` form remains (which prints message and STOPs). The has-`check` form is now handled inside `plan()`. Document this explicitly with a note: *"Gates with automated checks are handled inside `plan()` by the orchestrator; a `gate-stop` kind only reaches the conductor when the human action is genuinely required."*
- [ ] **Task C.4.** Modify §3 Verify and §4 Advance: spawn/fanout still call `verify` + `advance` per ADR-022. Add a note that for write/gate-check kinds the conductor never reaches §3 / §4.
- [ ] **Task C.5.** Update the §Rules block to remove rules made obsolete by ADR-023 (the "do not summarise or reshape worker output" rule still applies to spawn/fanout refs; the write-step substitution rule is removed).
- [ ] **Task C.6.** Update `ARCHITECTURE.md` — doctrine sections only (substrate sections updated in Phase H once extractions land). Specifically:
  - **"The orchestrator" section.** Rewrite the `Step` paragraph to distinguish engine-internal step kinds (`spawn | fanout | write | gate | done | halt`) from conductor-visible step kinds (`spawn | fanout | gate-stop | done | halt`). Note that `write` and `gate`-with-`check` are handled inside `plan()` under ADR-023.
  - **Verify/advance shape.** Rewrite to note that verify folds into advance for write/gate-check kinds; spawn/fanout keep ADR-022's separate verify + advance with claim-check refs.
  - **"Three layers, one direction" section.** Add a paragraph: *"The conductor (`/loop`) talks to two surfaces only — `mcp__orchestrator__*` and Claude Code's built-in `Task`. Cross-MCP work is initiated by the orchestrator (via library imports of `packages/<name>`) or by spawned workers (via their own MCP access). See ADR-023."*
  - **"Command surface" section.** Tighten `/loop`'s description from "plan → execute the Step → verify → advance" to reflect the narrower contract: "plan → if `spawn`/`fanout`, dispatch via Task and pass refs to advance; if `gate-stop`/`done`/`halt`, print and stop."
  - **"Where doctrine lives" section.** Add ADR-022 (claim-check) and ADR-023 (orchestrator-resident execution) to the load-bearing list.
- [ ] **Task C.7.** Run `pnpm sync:agents:check` and confirm no spurious diffs.
- [ ] **Task C.8.** Commit: `docs(loop): contract narrows — write + gate-check eagerly executed inside orchestrator (ADR-023)`.

## Phase D — Extract `packages/analytics`

The biggest write-step contributor (T2-partial, A1, A2, A3). Most operationally valuable graduation. Sets the extraction pattern that Phases E/F/G follow.

- [ ] **Task D.1.** Create `packages/analytics/` with `package.json`, `tsconfig.json`, `src/index.ts`. Pattern matches `packages/store/`.
- [ ] **Task D.2.** Move business logic files from `mcp-servers/analytics/src/` to `packages/analytics/src/`:
  - `ingest.ts` (ingest_meta_insights)
  - `rank.ts` (top_creatives, cost_per_angle)
  - `decay.ts` (decay_curve, engagement_per_angle)
  - `bandit.ts` (bandit_allocate, bandit_update)
  - `upsert.ts` (upsert_creative)
  - `log_event.ts`
  - `ingest_meta_organic.ts`
  - the SQLite connection wrapper + migration runner (will be reused at extraction time)
- [ ] **Task D.3.** Re-export tool-shaped functions from `packages/analytics/src/index.ts` so the orchestrator's exec dispatch table can reach them. Function-naming convention: `mcp__analytics__top_creatives` → `topCreatives` (camelCase).
- [ ] **Task D.4.** Rewrite `mcp-servers/analytics/src/index.ts` as a ~30-line stdio adapter that imports `packages/analytics` and registers each tool. Pattern: identical to `mcp-servers/store/src/index.ts`.
- [ ] **Task D.5.** Update `mcp-servers/analytics/package.json` to depend on the new package; remove now-redundant deps.
- [ ] **Task D.6.** Run the existing `mcp-servers/analytics/src/*.test.ts` suite — must pass unchanged. The MCP server's protocol surface is preserved by ADR-005 thin-adapter doctrine; this is the regression check.
- [ ] **Task D.7.** Update `packages/orchestrator/src/exec.dispatch.ts`: add rows for analytics tools.
  ```ts
  "mcp__analytics__ingest_meta_insights": (a, d) => d.analytics.ingestMetaInsights(a.rows),
  "mcp__analytics__top_creatives":         (a, d) => d.analytics.topCreatives(a.window_days, a.n, a.channel),
  "mcp__analytics__cost_per_angle":        (a, d) => d.analytics.costPerAngle(a.window_days, a.channel),
  "mcp__analytics__log_event":             (a, d) => d.analytics.logEvent(a.event_name, a.payload),
  // (other analytics tools as needed by write steps)
  ```
- [ ] **Task D.8.** Update `ExecDeps` interface to include `analytics`; update the orchestrator MCP's deps construction.
- [ ] **Task D.9.** Failing tests, then implementation:
  - `mcp-servers/orchestrator/src/integration.test.ts` extension: drive A1-ingest, A2-rank, A3-decay against fixture inputs; assert eager-execute path; assert SQLite rows written; assert engine state advances.
- [ ] **Task D.10.** Build green: `pnpm -r build` (sequential, per CLAUDE.md guidance). `pnpm test` across the repo.
- [ ] **Task D.11.** Commit: `feat(analytics): extract to packages/analytics; orchestrator self-executes A1/A2/A3 (ADR-023 Scope C)`.

## Phase E — Extract `packages/corpus`

Smaller surface than analytics; read-mostly. Worth doing now for future-proofing even though no current write step uses it.

- [ ] **Task E.1.** Same extraction pattern: `mcp-servers/corpus/src/` business logic → `packages/corpus/src/`.
- [ ] **Task E.2.** MCP server becomes thin adapter.
- [ ] **Task E.3.** Add `corpus` to `ExecDeps`; dispatch rows for the read tools (`search`, `get_compliance_block`, `list_proof`).
- [ ] **Task E.4.** Build + test green.
- [ ] **Task E.5.** Commit: `feat(corpus): extract to packages/corpus (ADR-023 Scope C)`.

## Phase F — Extract `packages/meta-ads`

The trickiest extraction — HTTP client, SHA-256 PII normalization, multipart upload, ADR-015 PAUSED-on-create invariants. Substantial; build extra-careful tests.

- [ ] **Task F.1.** Same extraction pattern. Migrate `capi.ts`, `insights.ts`, `create.ts`, `upload.ts`, helpers. Preserve the existing `META_CAPI_TEST_EVENT_CODE` env-injection behaviour (ADR-015 hard-wire).
- [ ] **Task F.2.** MCP server becomes thin adapter.
- [ ] **Task F.3.** Add `metaAds` to `ExecDeps`; dispatch rows for `capi_test_event`, `capi_send`, `get_insights`.
- [ ] **Task F.4.** Special test coverage: the test_event_code injection path (server-side enforcement); the PAUSED-on-create invariant (assertion that every `create_*` call routes through PAUSED-setting code); the SHA-256 PII normalization on user_data fields.
- [ ] **Task F.5.** Build + test green.
- [ ] **Task F.6.** Commit: `feat(meta-ads): extract to packages/meta-ads; T1/T2 graduate to orchestrator-resident (ADR-023 Scope C)`.

## Phase G — Extract `packages/experiment`

Smallest. Pure logic, no I/O of its own (reads via analytics).

- [ ] **Task G.1.** Same extraction pattern.
- [ ] **Task G.2.** MCP server becomes thin adapter.
- [ ] **Task G.3.** Add `experiment` to `ExecDeps`; dispatch rows.
- [ ] **Task G.4.** Build + test green.
- [ ] **Task G.5.** Commit: `feat(experiment): extract to packages/experiment (ADR-023 Scope C — complete coverage)`.

## Phase H — Live walk verification + PR

Two live walks. The resume of the wedged `run_1779611092`, and a fresh cold-start.

- [ ] **Task H.1.** Restart Claude Code so the orchestrator MCP picks up the new imports + exec path.
- [ ] **Task H.2.** **Resume walk.** `mcp__orchestrator__status` should still show `run_1779611092` at stage produce. Invoke `/loop run_1779611092`. Verify:
  - The conductor makes one `plan()` call.
  - The orchestrator's eager loop runs P3-persist (16 store.create + 1 store.query) and any subsequent self-executable steps.
  - The conductor sees `kind:"gate-stop"` for HG3 next.
  - No "result exceeds maximum allowed tokens" events in the transcript.
  - 16 CreativeVariants rows present in Postgres with `approvalStatus:"Awaiting Approval"`.
  - Compliance scanner invocations log: 16 entity-write scans.
- [ ] **Task H.3.** Take a Postgres snapshot of the HG3-reached state: `data/snapshots/hg3-run_1779611092/` (pattern matches the existing E-029 snapshot layout).
- [ ] **Task H.4.** **Fresh cold-start walk.** Wipe state. Run `/loop-once` cold. Auto-approve 4 briefs at HG1; auto-approve 4 scripts + all articles at HG2. Drive to HG3. Acceptance:
  - Conductor tool-call count from start to HG3 ≤ 30 (vs ~74 today).
  - All entity-write steps execute eagerly inside `plan()`.
  - No cap-class errors.
- [ ] **Task H.5.** Update `ARCHITECTURE.md` — substrate sections (doctrine sections were updated in Phase C):
  - **"Storage" section.** Add the `orchestrator.step_results` JSONB table (added by ADR-022) alongside the existing SQLite + 8-entity Postgres tables description.
  - **"MCP servers" section.** Refresh the 14-server list with the post-extraction split: `analytics`, `corpus`, `meta-ads`, `experiment` now have sibling `packages/<name>/` libraries; `store` already did; `youtube` and `heygen` remain unextracted (filed as follow-up). Add a sentence: *"The orchestrator MCP imports the packaged libraries directly in-process for write-step execution (ADR-023); the MCP servers continue to expose stdio tools to outside callers (the Claude Code main session, future scheduled runners)."*
  - **"Doctrine paragraph"** that today says *"Per ADR-005 / ADR-020: no MCP server opens a client to another MCP server."* — extend with: *"Per ADR-023: inside the workspace, prefer library imports over MCP stdio calls. The orchestrator MCP's in-process imports of `packages/<name>` are not mesh edges; they are same-process library calls."*
- [ ] **Task H.6.** Flip ADR-023 status `Proposed` → `Accepted`.
- [ ] **Task H.7.** Open the PR titled `feat(adr-023): orchestrator-resident execution — Scope C`. Description quotes the ADR Decision section + links the spec + the resume-walk artefacts.
- [ ] **Task H.8.** Squash to a single commit on merge to `main`. The 8 phase commits become the history-explainable squash body; the squash-commit message is the doctrine summary.

## Out of scope (not in this plan)

- Extract `packages/youtube` and `packages/heygen` — deferred until a write step from those services lands in `LIVE_REGISTRY`. Each can be done as a follow-up PR with no architectural decisions left.
- E-033 critic-evaluator step pattern — independent axis; tracked separately.
- E-030 SQLite → Postgres unification — independent axis; tracked separately. The analytics extraction sets the structure that makes E-030 a local change.
- Cross-MCP-mesh fallback — explicitly rejected; not built.

## Verification scoreboard (Phase H gate)

| Metric | Today | After ADR-023 (acceptance) |
|---|---|---|
| Conductor tool calls to HG3 (fresh walk) | ~74 + cap failure | ≤ 30 |
| Step kinds the conductor sees | 6 (write, gate-check, spawn, fanout, gate-stop, done) | 4 (spawn, fanout, gate-stop, done) |
| MCP servers the conductor talks to | orchestrator + 4–6 others | orchestrator only |
| Plan envelope max size on the wire | 238 KB (wedge) | < 5 KB |
| `mcp-servers/*` business-logic vs thin-adapter split | 1 of 7 thin (store) | 5 of 7 thin (store, analytics, corpus, meta-ads, experiment); youtube + heygen remain as TODOs |
| Tests | ~258 passing | ~260+ passing, no regressions |
