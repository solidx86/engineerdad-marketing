# B-023 — Experiment cell→variant join (angle-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `factorTags.angle` and `budgetBucket` on each `ExpVariantRow` by joining variant → script → brief at X1-query time, so `mapCellsToVariants` produces non-empty `variantPageIds` per cell and distribute's `cellIdFor()` returns a real `cellId` for every Meta-paid variant.

**Architecture:** Expand `X1-query` from 3 to 5 store calls (add `Scripts` + `Briefs`). Add a pure `projectExpVariant()` helper inside `packages/orchestrator/src/stages/experiment.ts` that walks the variant→script→brief chain in-memory and degrades gracefully on broken links. `allocatedCellsFor()` builds in-memory lookup maps and projects each variant row before passing to the existing pure `mapCellsToVariants` + `applyAllocation` functions. No schema migration. No P3-persist change. No creative-director prompt change.

**Tech Stack:** TypeScript, Vitest (`pnpm --filter @engineerdad/orchestrator test`), pnpm workspace builds (`pnpm --filter @engineerdad/orchestrator build`).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/orchestrator/src/stages/experiment.ts` | Modify | `x1Query.calls`: add Scripts + Briefs queries with explicit field projection. Add `projectExpVariant()` pure helper. Rewire `allocatedCellsFor()` to project before mapping. |
| `packages/orchestrator/src/stages/experiment.test.ts` | Modify | Update existing tests that stub `X1-query` to use the new 5-array shape with raw variant rows + side-table Scripts/Briefs. Add 5 new unit tests for `projectExpVariant`. Add 1 integration-shaped test for `allocatedCellsFor` doing the real join. |

No other files change. Spec §3.3 is the authority on what does NOT change.

---

## Task 1: Update existing tests to the new 5-array X1 result shape (RED — locked-in baseline)

This is a refactor-with-no-behavior-change: existing tests that stub X1-query as `[projectedVariants, hypotheses, experiments]` need to be updated to `[rawVariants, hypotheses, experiments, scripts, briefs]` BEFORE we change `experiment.ts`, so they fail in a predictable way and pin the new contract.

**Files:**
- Test: `packages/orchestrator/src/stages/experiment.test.ts`

- [ ] **Step 1: Update the X1-call-count assertion**

In `packages/orchestrator/src/stages/experiment.test.ts`, find the test `"X1 builds store queries for the run"` (around line 24). Replace its body with:

```ts
  it("X1 builds 5 store queries for the run (variants, hypotheses, experiments, scripts, briefs)", () => {
    const step = experimentStage.steps[0]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(5);
    expect(step.calls.every((c) => c.tool === "mcp__store__query")).toBe(true);
    const a0 = step.calls[0]!.args as { entity: string; filter: Record<string, unknown>; fields?: string[] };
    expect(a0.entity).toBe("CreativeVariants");
    expect(a0.filter).toEqual({ runId: "run_e", approvalStatus: "Approved" });
    expect(a0.fields).toEqual(["script"]);
    const a1 = step.calls[1]!.args as { entity: string; filter: Record<string, unknown> };
    expect(a1.entity).toBe("Hypotheses");
    expect(a1.filter).toEqual({ runId: "run_e" });
    const a2 = step.calls[2]!.args as { entity: string; filter: Record<string, unknown> };
    expect(a2.entity).toBe("Experiments");
    expect(a2.filter).toEqual({ runId: "run_e" });
    const a3 = step.calls[3]!.args as { entity: string; filter: Record<string, unknown>; fields: string[] };
    expect(a3.entity).toBe("Scripts");
    expect(a3.filter).toEqual({ runId: "run_e" });
    expect(a3.fields).toEqual(["brief"]);
    const a4 = step.calls[4]!.args as { entity: string; filter: Record<string, unknown>; fields: string[] };
    expect(a4.entity).toBe("Briefs");
    expect(a4.filter).toEqual({ runId: "run_e" });
    expect(a4.fields).toEqual(["angle", "budgetBucket"]);
  });
```

- [ ] **Step 2: Update the X3 happy-path test fixture**

Find the test `"X3 builds a store.create for the Experiments row"` (around line 111). Replace the `doneStep("X1-query", ...)` line with the 5-array shape carrying raw rows plus side tables:

```ts
      doneStep("X1-query", [
        [{ id: "v1", script: "s1" }],
        [],
        [],
        [{ id: "s1", brief: "b1" }],
        [{ id: "b1", angle: "fear", budgetBucket: "70" }],
      ]),
```

The rest of the test stays the same.

- [ ] **Step 3: Update `X3.verify delegates to verifyExperiment` test fixture**

Find the test `"X3.verify delegates to verifyExperiment — ok on a complete carried run"` (around line 137). Replace `doneStep("X1-query", [variants, [], []])` with:

```ts
      doneStep("X1-query", [
        [
          { id: "v1", script: "s1" },
          { id: "v2", script: "s2" },
        ],
        [],
        [],
        [
          { id: "s1", brief: "b1" },
          { id: "s2", brief: "b2" },
        ],
        [
          { id: "b1", angle: "fear", budgetBucket: "70" },
          { id: "b2", angle: "hope", budgetBucket: "20" },
        ],
      ]),
```

Delete the now-unused local `const variants = [...]` declaration above the run.

- [ ] **Step 4: Update `X3.verify fails a cell with no variants` test fixture**

Find the test `"X3.verify fails a cell with no variants"` (around line 163). Replace `doneStep("X1-query", [variants, [], []])` with:

```ts
      doneStep("X1-query", [
        [{ id: "v1", script: "s1" }],
        [],
        [],
        [{ id: "s1", brief: "b1" }],
        [{ id: "b1", angle: "fear", budgetBucket: "70" }],
      ]),
```

Delete the local `const variants = [...]` declaration.

- [ ] **Step 5: Update remaining `[[], [], []]` X1 stubs to 5-array shape**

For every other `doneStep("X1-query", [[], [], []])` in the file (the legitimate-skip and no-params tests around lines 53, 66, 88, 191), change to:

```ts
      doneStep("X1-query", [[], [], [], [], []]),
```

For the idempotent-existing test (around line 102–105) that has `[[], [], [{ pageId: "exp1" }]]`, change to:

```ts
      doneStep("X1-query", [[], [], [{ pageId: "exp1" }], [], []]),
```

- [ ] **Step 6: Run the test suite to confirm failures are the expected baseline**

Run: `pnpm --filter @engineerdad/orchestrator test -- experiment`

Expected: All updated tests FAIL — the X1-call-count test fails because the build still emits 3 calls; the X3-write happy path fails because `allocatedCellsFor()` still reads the projected-row shape from `x1[0]`.

- [ ] **Step 7: Commit the test updates**

```bash
git add packages/orchestrator/src/stages/experiment.test.ts
git commit -m "test(experiment): widen X1-query fixtures to 5-array shape

Pin the new contract before changing experiment.ts. X1 will return
raw variant rows + scripts + briefs side-tables; the projection
moves into allocatedCellsFor(). Tests fail until that change lands.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Add `projectExpVariant()` helper with unit tests

Add the pure projection helper and its tests. These tests act as the foundation; they don't depend on `experiment.ts` integration changes — only on the helper being exported (for tests only; not for external consumers).

**Files:**
- Modify: `packages/orchestrator/src/stages/experiment.ts`
- Test: `packages/orchestrator/src/stages/experiment.test.ts`

- [ ] **Step 1: Write the 5 unit tests for `projectExpVariant`**

In `packages/orchestrator/src/stages/experiment.test.ts`, add a new `import` line at the top:

```ts
import { __projectExpVariantForTests as projectExpVariant } from "./experiment.js";
```

At the bottom of the file (after the closing `});` of the `describe("experimentStage", ...)` block), add:

```ts
describe("projectExpVariant", () => {
  it("happy path — variant→script→brief resolves angle + budgetBucket", () => {
    const scripts = new Map([["s1", { brief: "b1" }]]);
    const briefs = new Map([["b1", { angle: "fear", budgetBucket: "70" }]]);
    const out = projectExpVariant({ id: "v1", script: "s1" }, scripts, briefs);
    expect(out).toEqual({ pageId: "v1", factorTags: { angle: "fear" }, budgetBucket: "70" });
  });

  it("missing script link — empty factorTags, null bucket, no throw", () => {
    const scripts = new Map<string, { brief?: string | null }>(); // empty
    const briefs = new Map();
    const out = projectExpVariant({ id: "v1", script: "s-missing" }, scripts, briefs);
    expect(out).toEqual({ pageId: "v1", factorTags: {}, budgetBucket: null });
  });

  it("missing brief link — empty factorTags, null bucket, no throw", () => {
    const scripts = new Map([["s1", { brief: "b-missing" }]]);
    const briefs = new Map();
    const out = projectExpVariant({ id: "v1", script: "s1" }, scripts, briefs);
    expect(out).toEqual({ pageId: "v1", factorTags: {}, budgetBucket: null });
  });

  it("brief missing budgetBucket — keeps angle, returns null bucket", () => {
    const scripts = new Map([["s1", { brief: "b1" }]]);
    const briefs = new Map([["b1", { angle: "fear", budgetBucket: null }]]);
    const out = projectExpVariant({ id: "v1", script: "s1" }, scripts, briefs);
    expect(out).toEqual({ pageId: "v1", factorTags: { angle: "fear" }, budgetBucket: null });
  });

  it("variant with no script field — empty factorTags, null bucket", () => {
    const scripts = new Map();
    const briefs = new Map();
    const out = projectExpVariant({ id: "v1" }, scripts, briefs);
    expect(out).toEqual({ pageId: "v1", factorTags: {}, budgetBucket: null });
  });

  it("brief budgetBucket with non-canonical value — returns null bucket", () => {
    const scripts = new Map([["s1", { brief: "b1" }]]);
    const briefs = new Map([["b1", { angle: "fear", budgetBucket: "weird" }]]);
    const out = projectExpVariant({ id: "v1", script: "s1" }, scripts, briefs);
    expect(out).toEqual({ pageId: "v1", factorTags: { angle: "fear" }, budgetBucket: null });
  });
});
```

- [ ] **Step 2: Run the 6 new tests to verify they fail (no helper exists yet)**

Run: `pnpm --filter @engineerdad/orchestrator test -- experiment -t projectExpVariant`

Expected: FAIL — `__projectExpVariantForTests` is not exported.

- [ ] **Step 3: Add the helper to `experiment.ts`**

In `packages/orchestrator/src/stages/experiment.ts`, find the `interface ExpVariantRow` block (around line 20) and immediately after the existing `function rowsOf(...)` definition, add the helper. Then add a test-only export at the bottom of the file.

Insert this function definition before `function designCellsOf(...)`:

```ts
type RawVariantRow = { id: string; script?: string | null };
type RawScriptRow = { brief?: string | null };
type RawBriefRow = { angle?: string | null; budgetBucket?: string | null };

/**
 * Walk variant → script → brief in-memory to assemble the ExpVariantRow
 * the allocation overlay expects. Degrades to empty factorTags + null
 * budgetBucket when any link is missing, so a partial run state (deleted
 * brief, etc.) doesn't take the whole stage down — observable downstream
 * as a cell with empty variantPageIds.
 */
function projectExpVariant(
  variant: RawVariantRow,
  scriptsById: Map<string, RawScriptRow>,
  briefsById: Map<string, RawBriefRow>,
): ExpVariantRow {
  const script = variant.script ? scriptsById.get(variant.script) : undefined;
  const brief = script?.brief ? briefsById.get(script.brief) : undefined;
  const factorTags: Record<string, string> = {};
  if (brief?.angle) factorTags.angle = brief.angle;
  const raw = brief?.budgetBucket;
  const budgetBucket: "70" | "20" | "10" | null =
    raw === "70" || raw === "20" || raw === "10" ? raw : null;
  return { pageId: variant.id, factorTags, budgetBucket };
}
```

At the very bottom of the file (after `export const experimentStage = ...`), add the test-only export:

```ts
/** Test-only export. Do not depend on this from production code. */
export const __projectExpVariantForTests = projectExpVariant;
```

- [ ] **Step 4: Run the 6 new tests to confirm they pass**

Run: `pnpm --filter @engineerdad/orchestrator test -- experiment -t projectExpVariant`

Expected: PASS (6 tests green).

- [ ] **Step 5: Commit the helper + its tests**

```bash
git add packages/orchestrator/src/stages/experiment.ts packages/orchestrator/src/stages/experiment.test.ts
git commit -m "feat(experiment): add projectExpVariant() helper

Pure function: walks variant.script -> scripts[].brief -> briefs[].
{angle, budgetBucket}. Degrades gracefully when any link is missing
(empty factorTags, null bucket) so a partial run state doesn't crash
the stage. 6 unit tests cover happy path + every missing-link case.

Helper is wired into allocatedCellsFor() in the next commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Wire `projectExpVariant` into X1-query and `allocatedCellsFor`

This is where the integration happens. After this task, all updated tests from Task 1 should pass.

**Files:**
- Modify: `packages/orchestrator/src/stages/experiment.ts`

- [ ] **Step 1: Expand X1-query from 3 to 5 calls**

In `packages/orchestrator/src/stages/experiment.ts`, find `const x1Query: StepSpec = { ... }` (around line 78). Replace its `calls` array with:

```ts
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "CreativeVariants",
          filter: { runId: run.runId, approvalStatus: "Approved" },
          fields: ["script"],
        },
      },
      {
        tool: "mcp__store__query",
        args: { entity: "Hypotheses", filter: { runId: run.runId } },
      },
      {
        tool: "mcp__store__query",
        args: { entity: "Experiments", filter: { runId: run.runId } },
      },
      {
        tool: "mcp__store__query",
        args: {
          entity: "Scripts",
          filter: { runId: run.runId },
          fields: ["brief"],
        },
      },
      {
        tool: "mcp__store__query",
        args: {
          entity: "Briefs",
          filter: { runId: run.runId },
          fields: ["angle", "budgetBucket"],
        },
      },
    ],
```

- [ ] **Step 2: Rewire `allocatedCellsFor()` to do the projection**

In the same file, find `function allocatedCellsFor(run: RunState): AllocatedCell[]` (around line 64). Replace its body with:

```ts
function allocatedCellsFor(run: RunState): AllocatedCell[] {
  const x1 = stepResult<unknown[]>(run, "X1-query") ?? [];
  const x2 = stepResult<unknown[]>(run, "X2-design") ?? [];
  const rawVariants = rowsOf(x1[0]) as RawVariantRow[];
  const rawScripts = rowsOf(x1[3]) as Array<RawScriptRow & { id: string }>;
  const rawBriefs = rowsOf(x1[4]) as Array<RawBriefRow & { id: string }>;
  const scriptsById = new Map<string, RawScriptRow>(rawScripts.map((s) => [s.id, s]));
  const briefsById = new Map<string, RawBriefRow>(rawBriefs.map((b) => [b.id, b]));
  const variants = rawVariants.map((v) => projectExpVariant(v, scriptsById, briefsById));
  const designCells = designCellsOf(x2[0]);
  return applyAllocation(mapCellsToVariants(designCells, variants));
}
```

- [ ] **Step 3: Run the full experiment test suite**

Run: `pnpm --filter @engineerdad/orchestrator test -- experiment`

Expected: All tests in `experiment.test.ts` PASS, including the previously-failing ones from Task 1 Step 6.

- [ ] **Step 4: Run the full orchestrator test suite (no regressions)**

Run: `pnpm --filter @engineerdad/orchestrator test`

Expected: All 287+ tests across 31 files PASS. (Adding 6 new tests in Task 2 brings expected total to ~293.)

- [ ] **Step 5: Build the orchestrator package**

Run: `pnpm --filter @engineerdad/orchestrator build`

Expected: clean `tsc` output (no type errors).

- [ ] **Step 6: Commit the integration**

```bash
git add packages/orchestrator/src/stages/experiment.ts
git commit -m "feat(experiment): wire projectExpVariant into X1-query + allocatedCellsFor

Closes B-023. X1-query now reads Scripts and Briefs alongside Variants
with explicit field projections. allocatedCellsFor builds lookup maps
and runs each variant through projectExpVariant before passing to the
existing pure allocation overlay.

After this commit, mapCellsToVariants produces non-empty variantPageIds
for cells whose factor levels match a brief's angle, and distribute's
cellIdFor() returns a real cellId for every Meta-paid variant.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Add the integration-shaped test for the join end-to-end

A higher-level test that exercises the real chain end-to-end via the public `build()` API, not the test-only export. Catches future regressions if anyone changes the call ordering in X1.

**Files:**
- Test: `packages/orchestrator/src/stages/experiment.test.ts`

- [ ] **Step 1: Add the integration test**

At the end of the `describe("projectExpVariant", ...)` block (or in a new `describe` block adjacent), add:

```ts
describe("allocatedCellsFor (integration via X3.build)", () => {
  it("joins variants→scripts→briefs and maps cells to non-empty variantPageIds", () => {
    const x3 = experimentStage.steps[2]!;
    const run: RunState = {
      runId: "run_e",
      stage: "experiment",
      status: "active",
      params: {},
      steps: [
        doneStep("S1-reason", {
          schemaVersion: 2, runId: "run_e", memoId: "m1",
          recommendedAngles: ["fear", "hope"], personas: [], topCreatives: {},
          hypothesisIds: [], banditAllocation: {},
          experimentParams: {
            hypothesis: "h",
            factors: [{ name: "angle", levels: ["fear", "hope"] }],
            holdConstant: [], primaryMetric: "cpa",
            dailyBudgetMyr: 200, durationDays: 7,
          },
        }),
        doneStep("X1-query", [
          // variants (raw rows with script ids)
          [
            { id: "v1", script: "s1" },
            { id: "v2", script: "s1" },
            { id: "v3", script: "s2" },
          ],
          [], // hypotheses
          [], // experiments
          // scripts
          [
            { id: "s1", brief: "b1" },
            { id: "s2", brief: "b2" },
          ],
          // briefs
          [
            { id: "b1", angle: "fear", budgetBucket: "70" },
            { id: "b2", angle: "hope", budgetBucket: "20" },
          ],
        ]),
        doneStep("X2-design", [
          {
            cells: [
              { cell_id: "c1", factor_levels: { angle: "fear" } },
              { cell_id: "c2", factor_levels: { angle: "hope" } },
            ],
          },
        ]),
      ],
    };
    const step = x3.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    // The first call is store.create on Experiments — its props.cells JSON
    // carries the AllocatedCell[] with populated variantPageIds.
    const createCall = step.calls[0]!.args as { props: { cells: string } };
    const cells = JSON.parse(createCall.props.cells) as Array<{
      cellId: string;
      variantPageIds: string[];
    }>;
    expect(cells).toHaveLength(2);
    const c1 = cells.find((c) => c.cellId === "c1")!;
    const c2 = cells.find((c) => c.cellId === "c2")!;
    expect(c1.variantPageIds.sort()).toEqual(["v1", "v2"]);
    expect(c2.variantPageIds).toEqual(["v3"]);
  });
});
```

The fixture uses the snake_case shape (`cell_id`, `factor_levels`) on X2-design output to also exercise the B-022 designCellsOf translation in the same path.

- [ ] **Step 2: Run the integration test**

Run: `pnpm --filter @engineerdad/orchestrator test -- experiment -t "allocatedCellsFor"`

Expected: PASS.

- [ ] **Step 3: Full suite green**

Run: `pnpm --filter @engineerdad/orchestrator test`

Expected: All tests PASS.

- [ ] **Step 4: Commit the integration test**

```bash
git add packages/orchestrator/src/stages/experiment.test.ts
git commit -m "test(experiment): integration test for X1→X3 cell→variant join

Exercises the full chain via x3.build(): raw X1 rows are joined
through projectExpVariant, designCellsOf normalizes snake_case
cells, and the resulting Experiments.cells JSON carries non-empty
variantPageIds per cell. Pins B-022 + B-023 together.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Update TASKS.md + close loop on B-022

B-022's `designCellsOf` fix was made on-the-fly while debugging the live walk (snake_case → camelCase translation in the helper). It's already in the working tree but has not been committed nor recorded. Close it here.

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Check whether the B-022 fix is staged or unstaged**

Run: `git status packages/orchestrator/src/stages/experiment.ts`

Expected: shows the file as modified (or already committed in this PR if the prior tasks staged it).

If the fix is unstaged, you'll need to keep it in the same commit as the B-023 wiring from Task 3. If it was already committed in Task 3, this task is purely a TASKS.md update.

- [ ] **Step 2: Add B-022 and B-023 entries to TASKS.md**

Open `TASKS.md`. Find the block of `### B-0xx` entries (around line 16, after the status header). Immediately above `### B-021`, insert:

```markdown
### B-023 `v1.5` `P1` `orchestrator` — experiment cells map to zero variants (`factorTags` never populated)
Fixed 2026-05-28. `mapCellsToVariants` matches cells to variants by `variant.factorTags[k] === cell.factorLevels[k]`, but `factorTags` existed only in test fixtures — no store schema column, no projection in X1-query, no writer in P3-persist. Surfaced on run_1779895374, the first run whose experiment stage actually executed (Brain Initiative Phase 0 wired `experimentParams` from the Decision Memo). Every cell ended up with empty `variantPageIds`, which made distribute's `cellIdFor()` return `null` for every Meta-paid variant. Fix: expand X1-query from 3 to 5 store calls (add `Scripts` + `Briefs` with explicit field projections), then walk variant.script → script.brief → brief.{angle, budgetBucket} in a pure `projectExpVariant()` helper called from `allocatedCellsFor()`. Angle-only scope; future generalization tracked in E-042 (+ format + persona) and E-043 (hook_register + language).

### B-022 `v1.5` `P1` `orchestrator` — `designCellsOf` snake_case ↔ camelCase mismatch
Fixed 2026-05-28. The experiment MCP emits `cell_id` / `factor_levels` per its public schema; the orchestrator's `DesignCell` interface expects `cellId` / `factorLevels`. `designCellsOf` cast without translating, so downstream `Object.entries(cell.factorLevels)` threw `Cannot convert undefined or null to object`. Latent since the experiment stage shipped — only surfaces when experimentParams actually drives X2→X3. Fix: explicit field-by-field translation accepting either case in `designCellsOf`.
```

- [ ] **Step 3: Bump the Status-header bug-count**

Same file, find the line that begins with `- **Open**: 4 bugs — B-005 (P1); B-010 (P1...` (around line 10). Update the count to reflect that B-022 and B-023 closed in this branch alongside B-018/19/20/21. The line should read:

```markdown
- **Open**: 4 bugs — B-005 (P1); B-010 (P1, fix landed, `/distribute` dry-run unverified); B-015 (P3, superseded by ADR-023's path-aware substitution); B-016 (P1, content slice fixed, rest open) · 17 enhancements + E-029-followup (enum-drift audit) + 6 new dormant Brain-Initiative-tail entries (E-036/E-037/E-038/E-039/E-040/E-041, `BlockedBy: Brain Initiative Phase 3`) + E-042 (multi-factor experiment generalization) + E-043 (hook_register + language as factors). E-035 shipped 2026-05-26 in Brain Initiative Phase 0. B-018/B-019/B-020 fixed 2026-05-27. B-021/B-022/B-023 fixed 2026-05-28.
```

- [ ] **Step 4: Add E-042 and E-043 enhancement stubs**

In the enhancements section of TASKS.md (find an existing `### E-0xx` heading and insert near it; placement is loose), add:

```markdown
### E-042 `v1.5` `P2` `orchestrator` — Generalize experiment cell→variant join to `format` + `persona`
Carved out from B-023 (2026-05-28). `projectExpVariant()` currently populates only `factorTags.angle` from Brief. Future Brain experiments will likely add `format` (variant column directly) and `persona` (Brief column) as factor axes. Smallest delta: extend the helper to read `variant.format` and `brief.persona`, and add those fields to the X1-query Briefs/Variants projections. Re-open when Brain emits a multi-factor experiment in the wild.

### E-043 `v1.5` `P3` `orchestrator` `agents` — Add `hook_register` + `language` as experiment factors
Carved out from B-023 (2026-05-28). Two factor axes that need structural work before the projection pattern can cover them: `hook_register` requires the creative-director to record which emotional register each chosen hook belongs to (new variant column or a `hooks[]` jsonb on the variant); `language` is per-render not per-variant (each variant carries both EN + BM copy), so an experiment on language requires splitting `(variant × language)` into separate routing rows at distribute time. Re-open when Brain's hypothesis bank starts proposing register- or language-axis experiments.
```

- [ ] **Step 5: Commit the docs update**

```bash
git add TASKS.md
git commit -m "docs(tasks): close B-022 + B-023, open E-042 + E-043

B-022: designCellsOf snake_case/camelCase fix (one-line surgery in the
helper, shipped alongside the B-023 wiring).

B-023: experiment cell-to-variant join — angle factor only, via
projectExpVariant() at X1-query time. No schema migration.

E-042: generalize the join to format + persona when Brain emits a
multi-factor experiment.

E-043: hook_register + language as factors — requires CD prompt change
and distribute restructure respectively. Deferred to when Brain proposes
those axes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: End-to-end validation walk on the live run

The unit + integration tests pin behavior, but the test plan in the PR explicitly calls for an HG3→HG4 walk on a real run. This validates that the orchestrator MCP picks up the rebuilt code, the join produces real `cellId`s through Postgres, and distribute reaches HG4.

**Prerequisites:** Claude Code restart between Task 3 commit and this task — the orchestrator MCP server loads `@engineerdad/orchestrator` at session start. The user/operator owns the restart; the agent cannot self-restart.

- [ ] **Step 1: Restart Claude Code (operator action)**

The operator must close and reopen Claude Code so the orchestrator MCP reloads with the new `experiment.ts`. This is a manual step — the agent cannot do it.

After restart, confirm the rebuilt dist exists:

Run: `ls -lh packages/orchestrator/dist/stages/experiment.js`

Expected: file present, mtime newer than the spec file.

- [ ] **Step 2: Reset the DB to the HG2 snapshot**

The HG3 snapshot of `run_1779895374` already has the experiment + distribute steps partially walked (and broken). Reset to HG2 and re-walk produce + experiment + distribute fresh.

Run:
```bash
docker exec -i engineerdad-postgres psql -U engineerdad \
  -d engineerdad_sb_feat_brain_experiment_params \
  < data/snapshots/main/hg2-run_1779895374/engineerdad.sql
rm -rf data/assets/run_1779895374
```

Expected: `CREATE INDEX` / `ALTER TABLE` output; assets dir gone.

- [ ] **Step 3: Confirm the run is at HG2 awaiting gate**

Run:
```bash
docker exec engineerdad-postgres psql -U engineerdad \
  -d engineerdad_sb_feat_brain_experiment_params \
  -c "SELECT id, stage, status FROM orchestrator.runs;"
```

Expected: `run_1779895374 | content | awaiting_gate` with 2 scripts and 1 article already approved (carried by the snapshot).

- [ ] **Step 4: Walk produce → HG3 via the `/produce` skill**

Issue `/produce run_1779895374` and follow the loop conductor through P1-fanout (2 units) → P2-render (4 units) → P3/P4/P5 (auto-written by plan()) → HG3 gate.

Expected: HG3 reached; 10 variants in DB (4 Carousel, 2 Feed, 2 Reel, 2 YT-Long); Feed assets populated (B-021 confirmed); render-stage wall time under 12 min total (A+B confirmed).

- [ ] **Step 5: Approve all 10 variants**

Run:
```bash
docker exec engineerdad-postgres psql -U engineerdad \
  -d engineerdad_sb_feat_brain_experiment_params \
  -c "UPDATE public.creative_variants SET approval_status='Approved', approver='solid' WHERE run_id='run_1779895374';"
```

Expected: `UPDATE 10`.

- [ ] **Step 6: Walk distribute → HG4 via the `/distribute` skill**

Issue `/distribute run_1779895374`. The orchestrator will:
- Clear HG3 (variants approved).
- Auto-execute schedule (S1-query, S2-stamp).
- Execute X1-query (now 5 calls) → X2-design (3 cells) → X3-write (Experiments row with non-empty variantPageIds on cell_01).
- Plan distribute D1-query, D2a-setup, D2b-route fanout, D3a-confirm, D3b-summary.
- STOP at HG4 awaiting Meta ads ACTIVE check.

Expected: HG4 reached. Distributions audit log has rows for every variant × channel attempt. At least cell_01's variants have non-null `cellId` in the D2b output and `routed` status (Meta-paid PAUSED creation succeeded).

- [ ] **Step 7: Verify the Experiments row**

Run:
```bash
docker exec engineerdad-postgres psql -U engineerdad \
  -d engineerdad_sb_feat_brain_experiment_params \
  -c "SELECT jsonb_pretty(cells::jsonb) FROM public.experiments WHERE run_id='run_1779895374';"
```

Expected: `cells` JSON shows 3 cells. `cell_01` (angle=epf-shortfall-parent-worry) has `variantPageIds.length === 10` (all 10 variants match since both approved scripts are EPF angle). `cell_02` and `cell_03` have empty `variantPageIds` (no children-fund or PCSF scripts were approved this run).

- [ ] **Step 8: Snapshot the HG4 state + commit**

Run:
```bash
mkdir -p data/snapshots/hg4-run_1779895374
docker exec engineerdad-postgres pg_dump --no-owner --no-acl --clean --if-exists \
  -U engineerdad -d engineerdad_sb_feat_brain_experiment_params \
  > data/snapshots/hg4-run_1779895374/engineerdad.sql
git add data/snapshots/hg4-run_1779895374
git commit -m "chore(snapshots): hg4-run_1779895374 — distribute reached HG4

First clean end-to-end walk of the Brain Initiative Phase 0 +
B-018/19/20/21/22/23 stack. Experiments row's cells JSON shows the
angle factor matched 10/10 variants into cell_01 (epf-shortfall);
distribute's D3b audit log carries one Distributions row per
variant × channel attempt; HG4 gate awaiting Meta ads ACTIVE check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 9: Push and finalize the PR**

Run:
```bash
git push
gh pr view 2 --json url --jq .url
```

Expected: push succeeds; PR URL printed. The PR now carries the closed test-plan box.

In the PR description, update the test-plan checkbox `[x] Walk HG3 → schedule → experiment → distribute → HG4 to validate experimentParams + B-018/19/20 end-to-end` from `[ ]` to `[x]`. (Optional: edit via `gh pr edit 2 --body ...`.)

---

## Self-Review

**Spec coverage:**
- Spec §2 (Architecture) — Tasks 2+3.
- Spec §3.1 (X1-query expansion + projectExpVariant + allocatedCellsFor rewire) — Task 3 Steps 1-2.
- Spec §3.2 (5 unit tests for projectExpVariant + extended fixtures + integration test) — Tasks 1, 2, 4.
- Spec §3.3 (no schema migration, no P3 change, no CD prompt change, no allocation.ts change) — enforced by File Structure table.
- Spec §4 (data flow with 5-array X1 result) — Tasks 1 Step 1 + Task 3 Step 1.
- Spec §5 (degrade-don't-throw error handling) — Task 2 Step 1 (the missing-link unit tests) + Step 3 (the helper implementation).
- Spec §6 (validation walk) — Task 6.
- Spec §7 (E-042 / E-043 carve-outs) — Task 5 Step 4.

All sections covered.

**Placeholder scan:** No TBDs, no "implement later", no vague handlers. Every step has either complete code or an exact shell command.

**Type consistency:**
- `projectExpVariant` signature in Task 2 Step 3 matches the test signature in Task 2 Step 1.
- `RawVariantRow` / `RawScriptRow` / `RawBriefRow` types defined in Task 2 Step 3 and referenced in Task 3 Step 2.
- `__projectExpVariantForTests` export name consistent between Task 2 Step 1 (import) and Task 2 Step 3 (export).
- `ExpVariantRow` interface from the existing `experiment.ts` (with `pageId`, `factorTags`, `budgetBucket`) is the return shape of `projectExpVariant` — matches.

No issues found.
