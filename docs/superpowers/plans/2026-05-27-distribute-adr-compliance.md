# Distribute ADR-compliance — Implementation Plan

**Date:** 2026-05-27
**Branch:** feat/brain-experiment-params
**Spec:** `2026-05-27-distribute-adr-compliance-design.html`

## 0. Preconditions

- Branch DB sandbox set up (today's earlier work: `pnpm db:sandbox` writes `.env.local`; MCPs read it).
- Live snapshot loaded into branch sandbox (`data/snapshots/hg3-assets-backfilled-run_1779779169/engineerdad.sql` already restored this session).
- Uncommitted edits exist on `distribute.ts` + `distribute.test.ts` (the D1-field-projection bug fix from earlier this session, 4 new tests passing). These get committed in Step 1.
- `engineerdad-postgres` container running.

## 1. Implementation sequence

### Step 1 — Commit the bug-fix (D1 field projection) `[bug]`

**What.** The D1 fields list, `projectVariant`/`projectArticle` helpers, and the 4 new tests for them are already in the working tree. Commit them as their own commit so the bug fix has a clean history independent of the larger refactor.

**Files**
- `packages/orchestrator/src/stages/distribute.ts` — already edited
- `packages/orchestrator/src/stages/distribute.test.ts` — already edited

**Commit message**
```
fix(distribute): D1-query field projection + row → DistVariant assembly

D1-query returned {id, title} only because no fields: list was passed,
crashing planDistribution at v.channels.includes(META). Add explicit
VARIANT_FIELDS / ARTICLE_FIELDS lists; add idempotent projectVariant
and projectArticle helpers that assemble metaSpec/ytSpec composites and
reverse-look up cellId from allocated cells. Existing test fixtures
(pre-projected) pass through unchanged.

12 distribute tests green (8 original + 4 new).
```

**Acceptance.** Commit lands on `feat/brain-experiment-params`; `git diff HEAD~1 -- packages/orchestrator/src/stages/distribute.ts` shows only the projection layer + fields lists.

---

### Step 2 — Distributions schema + zod + types `[data] [TDD]`

**Files**
- `packages/store/src/schema.ts` — add `distributions` pgTable + `Distributions` in `ENTITIES`
- `packages/shared/src/types.ts` — add `DistributionRow`
- `packages/shared/src/zod.ts` — add `DistributionRowSchema`
- `packages/shared/src/zod.test.ts` — round-trip test for the new schema
- `packages/store/src/crud.test.ts` — round-trip + append-only test
- `packages/store/drizzle/000X_distributions.sql` — generated

**What.** Define the table per §6 of the spec. `baseColumns()` already provides `id, runId, title, approvalStatus, createdBy, complianceCheck, createdAt, updatedAt`. Add the entity-specific columns: `targetEntity, targetId, channel, status, tool, attemptedAt, completedAt, outputJson, errorMessage, skipReason, attempt, dryRun, authorStep`.

Indexes: `(runId, createdAt desc)`, `(runId, channel)`, `(targetId)`.

**TDD order**
1. Write zod-schema test: a valid DistributionRow parses; missing required fields throw; enum values rejected outside the closed set.
2. Watch fail.
3. Implement `DistributionRowSchema`.
4. Write crud round-trip test: create → query returns the row; create twice → query returns 2 rows.
5. Watch fail (entity doesn't exist).
6. Add the pgTable + ENTITIES registration. Run `pnpm db:sandbox` to push schema to branch DB.
7. Watch pass.
8. Generate migration: `pnpm db:generate`. Commit the generated SQL alongside `schema.ts`.

**Compliance exemption.** Add `"Distributions"` to the compliance-scan exemption list (look in `packages/store/src/crud.ts` for where `PerformanceReports` is exempted; mirror that). Test: a Distributions row with the literal string `"buy our flagship fund"` in `errorMessage` creates successfully (a banned phrase in a non-exempt entity would fail).

**Acceptance.** `pnpm --filter @engineerdad/shared test zod` + `pnpm --filter @engineerdad/store test crud` green; `pnpm lint:migrations` passes; `docker exec engineerdad-postgres psql -U engineerdad -d $BRANCH_DB -c "\d distributions"` shows the expected schema.

---

### Step 3 — Decompose `planMetaPaid` `[engine] [TDD]`

**Files**
- `packages/orchestrator/src/distribute/plan-distribution.ts`
- `packages/orchestrator/src/distribute/plan-distribution.test.ts` — **new**

**What.** Split `planMetaPaid` into:
- `planMetaPaidSetup(runId, variants, cells, dailyBudgetMyr) → PlanPart` — campaign + adsets only. Skipped/empty when no routable Meta variants.
- `planMetaPaidRows(variants, cells) → PlanPart` — rowPlans + backfills only. Skip-handling identical to today's planMetaPaid.

Existing `planDistribution()` stays as a thin composer that calls `planMetaPaidSetup`, `planMetaPaidRows`, `planYouTube`, `planArticles`, `planOrganic` in order and merges with `mergeParts`. Behavior-preserving.

**TDD order**
1. Write tests for the two new functions in isolation: setup with 0/1/3 cells, rows with 0/1/N variants, all skip cases.
2. Watch fail.
3. Extract the two functions from `planMetaPaid` body.
4. Update `planDistribution` to call the new pair.
5. Watch pass.
6. Add one composition test: `planDistribution()` output matches the merged output of the decomposed functions (regression guard).

**Acceptance.** `plan-distribution.test.ts` green; existing `distribute.test.ts` green (it still calls the composed entry point); orchestrator-package build clean.

---

### Step 4 — D2a-setup step `[engine] [TDD]`

**Files**
- `packages/orchestrator/src/stages/distribute.ts` — add `d2aSetup: StepSpec`
- `packages/orchestrator/src/stages/distribute.test.ts` — add D2a tests

**What.** New `StepSpec` with `kind: "spawn"`, `build: async (run, ctx) => …`. Calls `planMetaPaidSetup`, stages `{setupSteps, dryRun}` via `ctx.stageInput(null, …)`, returns a spawn step with `setupPromptFor(ref)`.

Verifier: rejects null/non-object; otherwise pass. (Trust-of-record is D3-confirm via Meta entity ground truth.)

**TDD order**
1. Test: D2a build with N cells produces a spawn step; mockCtx receives one stageInput call with payload `{setupSteps: [...campaign + N adsets], dryRun: false}`; the spawnPrompt contains the returned `sr_…` ref.
2. Test: D2a build with 0 cells produces a spawn step with empty `setupSteps` and a worker prompt that still says "if empty, return null shape".
3. Test: D2a build honors `run.params.dryRun`.
4. Test: D2a verify accepts `{campaignId, adsetByCellId}`; rejects null.
5. Watch fail.
6. Implement `d2aSetup`, `setupPromptFor()`, the helper that reads cells + variants out of D1 result.
7. Watch pass.

**Acceptance.** 4 new D2a tests pass; existing distribute tests still pass.

---

### Step 5 — D2b-route step `[engine] [TDD]`

**Files**
- `packages/orchestrator/src/stages/distribute.ts` — add `d2bRoute: StepSpec`
- `packages/orchestrator/src/stages/distribute.test.ts` — add D2b tests

**What.** New `StepSpec` with `kind: "fanout"`, `build: async (run, ctx) => …`. Per spec §5.4. Helpers: `attachBackfills(planPart) → RouteUnit[]`, `resolveSetupRefs(unit, setup) → RouteUnit`, `routePromptFor(ref, channel)`.

**TDD order**
1. Test: D2b build with 3 Meta-paid rowPlans + 1 organic rowPlan produces 4 fanout units; each unit's stageInput payload has the correct `{channel, rowPlan, backfill, dryRun, runId}` shape.
2. Test: Setup-IDs are substituted into row plans before staging — a rowPlan that needs `adset:cell-A` ends up with the actual adsetId from D2a's result.
3. Test: Dual-channel variant → 2 units (Meta-paid + Meta-organic), each with the appropriate rowPlan.
4. Test: Channel filter `["Meta-organic"]` in run.params emits only Meta-organic units.
5. Test: Dry-run flag propagates to every unit's stageInput payload.
6. Test: 0 rowPlans → 0 units (fanout returns empty).
7. Test: D2b verify accepts array result; rejects non-array.
8. Watch fail.
9. Implement `d2bRoute`.
10. Watch pass.

**Acceptance.** 7 new D2b tests pass.

---

### Step 6 — D3-confirm summary writes `[engine] [TDD]`

**Files**
- `packages/orchestrator/src/stages/distribute.ts` — extend `d3Confirm`
- `packages/orchestrator/src/stages/distribute.test.ts` — add summary-write tests

**What.** D3 currently is `kind: "write"` with two queries (variants + articles) and a verify. We add **three more** `mcp__store__create` calls per matched (variant×channel) and per article — one per outcome.

The calls are derived from the verifyDistribute diff: for each expected variant×channel, if the actual row carries the ground-truth field (adId / ytVideoId / fbPostId), status="routed"; else status="failed". Same for articles via deliveredAt.

Summary rows carry `authorStep: "D3-confirm"`, `attempt: <count + 1>`, `attemptedAt: <now>`, `completedAt: <now>`, `tool: null`.

**TDD order**
1. Test: D3 build emits N+M store.create calls (N = variant×channel pairs, M = articles) in addition to the 2 queries.
2. Test: For a variant with channels=["Meta-paid","Meta-organic"] and adId set but fbPostId unset, the summary rows are: 1 routed Meta-paid + 1 failed Meta-organic.
3. Test: D3 verify still delegates to verifyDistribute on the queried rows (unchanged behavior; the summary writes are side effects).
4. Watch fail.
5. Implement the summary-write derivation inside `d3Confirm.build`.
6. Watch pass.

**Acceptance.** 3 new D3 tests pass; existing verifyDistribute tests still pass.

---

### Step 7 — Registry wiring `[engine]`

**Files**
- `packages/orchestrator/src/stages/distribute.ts` — replace `d2Route` with `d2aSetup` + `d2bRoute` in the exported `distributeStage`
- `packages/orchestrator/src/registry.test.ts` — assert distribute stage has 5 steps

**What.** Update the exported stage:

```ts
export const distributeStage: StageDefinition = {
  id: "distribute",
  steps: [d1Query, d2aSetup, d2bRoute, d3Confirm, d4Gate],
};
```

Delete the old `d2Route` spec definition (no longer referenced).

**Acceptance.** Registry test asserts `distribute.steps.map(s => s.id) === ["D1-query","D2a-setup","D2b-route","D3-confirm","D4-gate"]`; full orchestrator test suite green.

---

### Step 8 — Webapp review page `[ui] [TDD]`

**Files**
- `apps/webapp/src/app/api/review/distributions/route.ts` — **new**
- `apps/webapp/src/app/review/distributions/page.tsx` — **new**
- `apps/webapp/src/app/runs/[runId]/page.tsx` (or equivalent) — add nav link
- `apps/webapp/e2e/distributions-review.spec.ts` — **new** Playwright test

**What.** API route: read `runId` from query params; call `mcp__store__query` with the Distributions field projection; return rows as JSON.

Page: client component that fetches the API route, renders the table per spec §7. Status pill component, mismatch detection between D2b/D3 pairs, channel/status/authorStep filter dropdowns.

Nav link: append `→ Distributions` next to the distribute stage chip on the run detail page.

**TDD order**
1. Write Playwright test: seed 3 known Distributions rows via store API; visit the page; assert table rows + colors + filter behavior.
2. Watch fail (route doesn't exist).
3. Implement the API route.
4. Implement the page.
5. Watch pass.
6. Add mismatch-marker test: create a D2b "routed" + D3 "failed" pair for the same target; verify 🚩 appears on the D2b row.
7. Watch fail.
8. Implement the mismatch detector.
9. Watch pass.

**Acceptance.** `pnpm --filter @engineerdad/webapp test:e2e -- distributions-review` green; manual visit to `/review/distributions?runId=run_1779779169` renders without error.

---

### Step 9 — Build everything `[ops]`

**What**
```
pnpm -r --filter='!@engineerdad/webapp' build
pnpm --filter @engineerdad/webapp build  # webapp built separately per CLAUDE.md
pnpm --filter @engineerdad/shared test
pnpm --filter @engineerdad/store test
pnpm --filter @engineerdad/orchestrator test
pnpm --filter @engineerdad/analytics test  # ensure no regression
```

**Acceptance.** All builds clean, all suites green.

---

### Step 10 — Reset in-flight run + restart Claude Code `[ops]`

**What.** The branch sandbox holds `run_1779779169` with completed `D1-query`, `D2-route` (or absence thereof — we previously deleted D1 to force replay), `D3-confirm`, `D4-gate` rows. Under the new schema (D2a/D2b instead of D2), those step rows would never be re-evaluated. Reset them.

```bash
DB=engineerdad_sb_feat_brain_experiment_params
docker exec engineerdad-postgres psql -U engineerdad -d "$DB" \
  -c "DELETE FROM orchestrator.run_steps
       WHERE run_id='run_1779779169'
         AND step_id IN ('D1-query','D2-route','D2a-setup','D2b-route','D3-confirm','D4-gate');"
docker exec engineerdad-postgres psql -U engineerdad -d "$DB" \
  -c "UPDATE orchestrator.runs
       SET stage='distribute', status='active'
       WHERE id='run_1779779169';"
```

Restart Claude Code so the orchestrator MCP picks up the rebuilt code.

**Acceptance.** After restart, `mcp__orchestrator__status` shows `run_1779779169` at `distribute / active`.

---

### Step 11 — Manual end-to-end walk `[ops]`

**What.** From the new Claude Code session, resume `/loop run_1779779169`. Expected path:

1. **D1-query** runs eager; D1 result has full `channels`, `format`, `metaPrimaryTextEn`, etc.
2. **D2a-setup** dispatches one general-purpose worker. Worker reads the ref, finds empty `setupSteps` (no Meta cells), returns `{campaignId: null, adsetByCellId: {}}`.
3. **D2b-route** fans out:
   - 3 Meta-paid units (one each for the 3 approved Meta-paid variants). Each worker pre-checks → no Meta cell assigned → writes Distributions row `{status: "skipped", skipReason: "not assigned to an experiment cell", authorStep: "D2b-route"}` → returns.
   - 1 Meta-organic unit (for the Carousel 1:1). Worker checks fbPostId (null) → executes `publish_carousel_post` → writes Distributions row `{status: "routed", outputJson: {fbPostId: "..."}, authorStep: "D2b-route"}` → backfills `fbPostId` onto the variant.
4. **D3-confirm** re-queries; `verifyDistribute` sees: 3 Meta-paid variants without adId (FAIL) + 1 Meta-organic variant with fbPostId (PASS). Writes 4 summary Distributions rows (3 failed + 1 routed, all `authorStep: "D3-confirm"`). The verifier returns `ok: false` → the run pauses with the verify problems.
5. Alternative path: if we want the walk to reach D4-gate cleanly, mark the Meta-paid variants' approval status back to "Awaiting Approval" or change the test setup. **For this verification walk, expect the loop to stop at D3-confirm verify failure** — the run had no experiment cells, so Meta routing was always going to fail. That's the correct behavior: D3 is the ground-truth check.

Visit `http://localhost:3030/review/distributions?runId=run_1779779169`. Expect ~8 rows: 4 from D2b (3 skipped + 1 routed) and 4 from D3-confirm (3 failed + 1 routed).

**Acceptance.** Loop walks D1 → D2a → D2b → D3-confirm without crashing; webapp shows ~8 Distributions rows with the expected channel/status mix; no rows appear in live `engineerdad` DB (sandbox-only routing verified).

---

### Step 12 — Update TASKS.md + commit `[ops]`

**What.** Add a closed entry referencing the design + plan; add a follow-up entry for E-024 (IG integration into D2b). Commit everything from Steps 2–11 as a single coherent commit (or 2–3 commits split by concern: schema/types, orchestrator stages, webapp).

**Commit message (single-commit option)**
```
feat(distribute): split D2 into D2a/D2b; add Distributions entity + review page

- plan-distribution.ts: extract planMetaPaidSetup / planMetaPaidRows
- distribute.ts: D2-route → D2a-setup (spawn) + D2b-route (fanout)
  per ADR-024 (ctx.stageInput, sr_ refs in spawnPrompts)
- packages/store: new Distributions entity (append-only event log)
- packages/shared: DistributionRow + zod schema
- apps/webapp: /review/distributions list page + API route
- D3-confirm: write Distributions summary rows alongside verify

Spec: docs/superpowers/specs/2026-05-27-distribute-adr-compliance-design.html
Plan: docs/superpowers/plans/2026-05-27-distribute-adr-compliance.html
```

**Acceptance.** Commit(s) on branch; `git status` clean; TASKS.md reflects the work.

---

## 2. Verification matrix

| Scenario | Expected | How to confirm |
|---|---|---|
| D1 returns rows with channels populated | No "Cannot read properties of undefined" crash; D2a/D2b builds run cleanly | Step 1's existing 4 tests |
| D2a empty-cells case | Worker returns null shape; D2b proceeds | Step 4 test + Step 11 manual walk |
| D2b fans out per (channel × rowPlan) | N units for N rowPlans | Step 5 tests |
| Dual-channel variant produces 2 units | Meta-paid unit + Meta-organic unit, both staged | Step 5 dual-channel test |
| D3-confirm writes summary rows | 1 row per (variant×channel) + 1 per article | Step 6 tests + DB inspect after Step 11 |
| Distributions log surfaces in webapp | Rows visible at `/review/distributions?runId=…` | Step 8 Playwright + Step 11 manual visit |
| Mismatch detector flags worker-vs-truth disagreement | 🚩 on D2b row when D3 says different | Step 8 mismatch test |
| spawnPrompt size stays under cap | D2a + every D2b unit prompt < 2 KB | Inspect via `SELECT length(payload::text) FROM orchestrator.step_results WHERE …` after Step 11 |
| IG manual path unaffected | `/posting-pack` still functions; no IG units in D2b | Run `/posting-pack` after Step 11; compare to a previous pack |
| Live DB untouched | 0 Distributions rows in live `engineerdad` | `docker exec ... -d engineerdad -c "SELECT COUNT(*) FROM distributions"` = 0 |

## 3. Rollback

If something goes wrong post-merge:

1. **Revert the commit(s)** on the branch. The Drizzle migration reverts via `pnpm db:generate` producing a down-diff against main's schema; manual SQL drop of the `distributions` table is acceptable as a quicker path on the sandbox.
2. **Branch DB** is throwaway — re-run `pnpm db:sandbox` after revert and reload the snapshot.
3. **Live DB** was never touched by this work (the safety guard from this morning's branch-DB routing work prevents the MCP from writing to `engineerdad` from this branch).
4. The pre-existing `D2-route` step name disappears under the new schema — runs created on the new schema can't be replayed on the old code without reverting their `run_steps` too. Document this in the revert PR if it ever happens.

## 4. Open questions deferred to implementation

- **Where exactly does the compliance exemption list live?** Probably `packages/store/src/crud.ts` based on the `PerformanceReports` precedent, but verify on first read. If it's elsewhere (e.g. `complianceScan` module), edit there instead.
- **RouteUnit type definition.** Pick a place for it — `packages/orchestrator/src/distribute/types.ts` (new) or inline in `distribute.ts`. Inline is fine for now; extract if a third caller appears.
- **Title synthesis for Distributions rows.** Spec says `"<channel> · <targetEntity> <short-id>"` — make it a small helper, test that it produces stable strings for the same input.
- **Backfill steps that today are part of `planDistribution`'s top-level backfills array.** Under the new design they ride per-unit (each worker runs its own backfill). Confirm during Step 5 that no orphan backfills are left in the global backfills array; if any are truly cross-row, decide whether to keep them as a post-fanout D2c step or fold into D3-confirm.
- **Webapp nav link insertion point.** The exact file path for the run detail page may differ from `apps/webapp/src/app/runs/[runId]/page.tsx`; grep for the existing distribute-stage section and add the link nearby.
