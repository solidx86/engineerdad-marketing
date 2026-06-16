# Brain Initiative — Phase 0 Implementation Plan (`experimentParams` wiring)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `experimentParams` from Brain's Decision Memo into the experiment stage so the `/loop` cycle reaches HG4 instead of halting at `factors must be non-empty`. Ship as the Phase 0 PR off `feat/brain-experiment-params` (or its rename to `feat/brain-initiative`) per the Brain Initiative umbrella spec.

**Architecture:** Three-commit slice. (C1) Extract the implicit Decision Memo shape into a real shared type in `packages/shared/src/types/brain.ts`, giving v2 a defined contract that v3 will extend later. (C2) Replace `experiment.ts`'s `run.params as unknown as ExperimentParams` cast with a memo-reading helper that pulls the params from the synthesize step result; add a legitimate-skip path for cold-start (Brain has no test to run). (C3) Harden the synthesize verifier to assert `experimentParams` shape when present, allow absent (cold-start escape), and update `brain.md` §B-step-9 EMIT to emit the block.

**Tech Stack:** TypeScript, pnpm workspace, vitest, drizzle-kit (no schema changes in Phase 0), Postgres 16-alpine via docker compose.

**Spec source:** `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §4.

---

## File Structure (what's new, what's modified, what's deleted)

| Path | Change | Why |
|---|---|---|
| `packages/shared/src/types/brain.ts` | **NEW** | Single source for `ExperimentParams` + `DecisionMemoV2`. v3 extends V2 in Phase 2, so it has to exist as a real type now. |
| `packages/shared/src/types/brain.test.ts` | **NEW** | Type-level + value-shape tests (factors-array-required, etc.). |
| `packages/shared/src/index.ts` | Modify | Add `export * from "./types/brain.js"` |
| `packages/orchestrator/src/stages/experiment.ts` | Modify | Delete local `interface ExperimentParams` and the `run.params` cast. Add `memoParams()` + `experimentDeclined()` helpers; X2-design and X3-write read from memo; both no-op on `experimentDeclined === true`. |
| `packages/orchestrator/src/stages/experiment.test.ts` | Modify | Existing X2 spec switches from `run.params` to a fake `S1-reason` step result. Add 4 new specs: X2 declines, X3 declines (build + verify), camelCase→snake_case unpack. |
| `packages/orchestrator/src/verifiers/verify-synthesize.ts` | Modify | Add `verifyExperimentParams()`. Call it from `verifySynthesize` only when `memo.experimentParams !== undefined`. |
| `packages/orchestrator/src/verifiers/verify-synthesize.test.ts` | Modify | Add 6 new specs (legitimate-skip, valid block, 4 failure modes). |
| `.claude/agents/brain.md` | Modify | §B-step-9 EMIT step 3: extend payload with `experimentParams` construction instructions + cold-start escape rule. §C: add row 10 reference. Hard rules: new bullet about ≥2 levels. |
| `TASKS.md` | Modify | Close E-035 (status: shipped Phase 0). Open dormant E-036/E-037/E-038/E-039/E-040/E-041 entries `BlockedBy: Brain Initiative Phase 3`. |
| `docs/superpowers/specs/2026-05-24-brain-moe-critic-topology-design.html` | **DELETE** | Superseded by umbrella spec. |
| `docs/superpowers/specs/2026-05-25-brain-experiment-params-design.html` | **DELETE** | Superseded. |
| `docs/superpowers/specs/2026-05-25-brain-experiment-params-design.md` | **DELETE** | Superseded. |

**Commit grouping:** Tasks 1–2 → commit C1; Tasks 3–5 → commit C2; Task 6–7 → commit C3; Task 8–9 → commit "chore" + integration verification (no code).

---

## Task 1: Create the shared `brain.ts` type file (TDD)

**Files:**
- Create: `packages/shared/src/types/brain.ts`
- Create: `packages/shared/src/types/brain.test.ts`
- Modify: `packages/shared/src/index.ts:1-3`

- [ ] **Step 1.1: Write the failing test for type exports**

Create `packages/shared/src/types/brain.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ExperimentParams, DecisionMemoV2 } from "./brain.js";

describe("brain types", () => {
  it("ExperimentParams requires hypothesis, factors[], holdConstant, primaryMetric, dailyBudgetMyr, durationDays", () => {
    const valid: ExperimentParams = {
      hypothesis: "fear beats hope",
      factors: [{ name: "angle", levels: ["fear", "aspiration", "curiosity"] }],
      holdConstant: [],
      primaryMetric: "cpa",
      dailyBudgetMyr: 200,
      durationDays: 7,
    };
    expectTypeOf(valid).toMatchTypeOf<ExperimentParams>();
  });

  it("DecisionMemoV2 carries optional experimentParams (Brain may decline)", () => {
    const withParams: DecisionMemoV2 = {
      schemaVersion: 2,
      runId: "run_1",
      memoId: "memo_1",
      recommendedAngles: ["fear", "aspiration", "curiosity"],
      personas: ["young_parents_25_35"],
      topCreatives: {},
      hypothesisIds: ["h1"],
      banditAllocation: {},
      experimentParams: {
        hypothesis: "fear beats hope",
        factors: [{ name: "angle", levels: ["fear", "aspiration", "curiosity"] }],
        holdConstant: [],
        primaryMetric: "cpa",
        dailyBudgetMyr: 200,
        durationDays: 7,
      },
    };
    const withoutParams: DecisionMemoV2 = {
      schemaVersion: 2,
      runId: "run_1",
      memoId: "memo_1",
      recommendedAngles: ["solo"],
      personas: [],
      topCreatives: {},
      hypothesisIds: [],
      banditAllocation: {},
    };
    expectTypeOf(withParams).toMatchTypeOf<DecisionMemoV2>();
    expectTypeOf(withoutParams).toMatchTypeOf<DecisionMemoV2>();
  });

  it("primaryMetric is restricted to the 4-value enum", () => {
    expectTypeOf<ExperimentParams["primaryMetric"]>()
      .toEqualTypeOf<"cpa" | "hook_rate" | "thumbstop" | "ctr">();
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `pnpm vitest run packages/shared/src/types/brain.test.ts`
Expected: FAIL — `Cannot find module './brain.js'` (the file doesn't exist yet).

- [ ] **Step 1.3: Create the type file**

Create `packages/shared/src/types/brain.ts`:

```ts
/**
 * Shared Brain types. V2 is the current Decision Memo shape; V3 will extend it
 * in Brain Initiative Phase 2 (MoE-Critic). experimentParams is optional —
 * Brain emits no block on cold-start (single recommended angle) and the
 * experiment stage takes the legitimate-skip path.
 */

export interface ExperimentParams {
  hypothesis: string;
  factors: Array<{ name: string; levels: string[] }>;
  holdConstant: string[];
  primaryMetric: "cpa" | "hook_rate" | "thumbstop" | "ctr";
  dailyBudgetMyr: number;
  durationDays: number;
}

export interface DecisionMemoV2 {
  schemaVersion: 2;
  runId: string;
  memoId: string;
  recommendedAngles: string[];
  personas: string[];
  topCreatives: unknown;        // pass-through from analytics
  hypothesisIds: string[];
  banditAllocation: unknown;    // pass-through from analytics
  experimentParams?: ExperimentParams;
  notes?: string;
}
```

- [ ] **Step 1.4: Wire the export**

Edit `packages/shared/src/index.ts` — add line 2 after the existing `export * from "./types.js"`:

```ts
export * from "./types.js";
export * from "./types/brain.js";   // ← new
export * from "./derive/index.js";
export * as zod from "./zod.js";
// ... (rest unchanged)
```

- [ ] **Step 1.5: Run the test to verify it passes**

Run: `pnpm vitest run packages/shared/src/types/brain.test.ts`
Expected: PASS — all 3 specs.

- [ ] **Step 1.6: Sequential build to confirm typecheck across the workspace**

Run: `pnpm -r build`
Expected: PASS, all packages typecheck.

(Reminder from CLAUDE.md: never `pnpm -r --parallel build` — it races on `@engineerdad/shared`.)

- [ ] **Step 1.7: Commit C1 (part 1)**

```bash
git add packages/shared/src/types/brain.ts packages/shared/src/types/brain.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): extract DecisionMemoV2 + ExperimentParams types

Single shared type file so the experiment stage and the synthesize
verifier reference one definition. V3 will extend V2 in Phase 2."
```

---

## Task 2: Wire the import sites (no behavior change yet)

**Files:**
- Modify: `packages/orchestrator/src/stages/experiment.ts:18-26` (the local `interface ExperimentParams` becomes unused; do not remove yet — Task 5 deletes it once the new helpers are in place)

This task is the import-side scaffolding only. The actual behavior swap happens in Task 3.

- [ ] **Step 2.1: Add the import to `experiment.ts`**

Edit `packages/orchestrator/src/stages/experiment.ts` line 1 — add the import:

```ts
import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import type { ExperimentParams, DecisionMemoV2 } from "@engineerdad/shared";  // ← new
import {
  mapCellsToVariants,
  applyAllocation,
  type AllocatedCell,
} from "../experiment/allocation.js";
import { verifyExperiment } from "../verifiers/verify-experiment.js";
```

- [ ] **Step 2.2: Run the build to confirm the import resolves**

Run: `pnpm -r build`
Expected: PASS. The local `interface ExperimentParams` at lines 19–26 will become a duplicate definition — TypeScript will emit a `TS2300: Duplicate identifier 'ExperimentParams'`.

- [ ] **Step 2.3: Rename the local interface to defuse the collision temporarily**

Edit `packages/orchestrator/src/stages/experiment.ts:19-26` — rename to `LegacyExperimentParams`:

```ts
/** @deprecated removed in Task 5 once memoParams() is the only reader. */
interface LegacyExperimentParams {
  hypothesis?: string;
  factors?: { name: string; levels: string[] }[];
  holdConstant?: string[];
  primaryMetric?: string;
  dailyBudgetMyr?: number;
  durationDays?: number;
}
```

And update line 104 in the same file:

```ts
const p = run.params as unknown as LegacyExperimentParams;
```

- [ ] **Step 2.4: Run the build + tests to confirm no regression**

Run: `pnpm -r build && pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts`
Expected: PASS — same behavior as before the rename. The shared `ExperimentParams` is imported but not yet used; the legacy interface holds the old shape.

(No commit yet; this is part of the C2 slice that completes in Task 5.)

---

## Task 3: Add `memoParams` + `experimentDeclined` helpers (TDD)

**Files:**
- Modify: `packages/orchestrator/src/stages/experiment.ts:40` (after the existing `stepResult` helper, before `rowsOf`)
- Modify: `packages/orchestrator/src/stages/experiment.test.ts`

- [ ] **Step 3.1: Write the failing test for X2 legitimate-skip**

Add this spec to `packages/orchestrator/src/stages/experiment.test.ts` (after the existing X2 specs, before the X3 specs):

```ts
  it("X2 no-ops when synthesize memo carries no experimentParams (legitimate-skip)", () => {
    const run = runWith([
      doneStep("S1-reason", { schemaVersion: 2, runId: "run_e", memoId: "m1",
                              recommendedAngles: ["fear"], personas: [], topCreatives: {},
                              hypothesisIds: [], banditAllocation: {} }),
      doneStep("X1-query", [[], [], []]),
    ]);
    const step = experimentStage.steps[1]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(0);
  });

  it("X2 unpacks camelCase memo block into snake_case mcp__experiment__design args", () => {
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear", "aspiration", "curiosity"],
        personas: [], topCreatives: {}, hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "fear beats hope",
          factors: [{ name: "angle", levels: ["fear", "aspiration", "curiosity"] }],
          holdConstant: [],
          primaryMetric: "cpa",
          dailyBudgetMyr: 200,
          durationDays: 7,
        },
      }),
      doneStep("X1-query", [[], [], []]),
    ]);
    const step = experimentStage.steps[1]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    const args = step.calls[0]!.args as Record<string, unknown>;
    expect(args.hypothesis).toBe("fear beats hope");
    expect(args.factors).toEqual([{ name: "angle", levels: ["fear", "aspiration", "curiosity"] }]);
    expect(args.hold_constant).toEqual([]);
    expect(args.primary_metric).toBe("cpa");
    expect(args.daily_budget_myr).toBe(200);
    expect(args.duration_days).toBe(7);
  });
```

- [ ] **Step 3.2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts -t "X2 no-ops when synthesize memo"`
Expected: FAIL — current X2 reads `run.params`, not the memo step result. The call goes through with `factors: []`.

Run: `pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts -t "X2 unpacks camelCase memo"`
Expected: FAIL — same reason.

- [ ] **Step 3.3: Add the two helpers**

Edit `packages/orchestrator/src/stages/experiment.ts` — insert after line 42 (after the existing `stepResult` helper):

```ts
/** Read experimentParams from the synthesize memo (S1-reason step result). */
function memoParams(run: RunState): ExperimentParams | undefined {
  const memo = stepResult<DecisionMemoV2>(run, "S1-reason");
  return memo?.experimentParams;
}

/**
 * Brain declined to design an experiment this cycle. Either the synthesize
 * memo is missing (legacy run) or experimentParams is absent / has empty
 * factors. The experiment stage no-ops; the run flows past into distribute.
 */
function experimentDeclined(run: RunState): boolean {
  const p = memoParams(run);
  return !p || !p.factors || p.factors.length === 0;
}
```

- [ ] **Step 3.4: Rewrite X2-design's `build`**

Edit `packages/orchestrator/src/stages/experiment.ts:97-123` — replace the entire `x2Design` block:

```ts
const x2Design: StepSpec = {
  id: "X2-design",
  kind: "write",
  build: (run): Step => {
    if (experimentExists(run)) {
      return { kind: "write", stepId: "X2-design", calls: [] }; // idempotent no-op
    }
    if (experimentDeclined(run)) {
      return { kind: "write", stepId: "X2-design", calls: [] }; // legitimate-skip
    }
    const p = memoParams(run)!;
    return {
      kind: "write",
      stepId: "X2-design",
      calls: [
        {
          tool: "mcp__experiment__design",
          args: {
            hypothesis: p.hypothesis,
            factors: p.factors,
            hold_constant: p.holdConstant,
            primary_metric: p.primaryMetric,
            daily_budget_myr: p.dailyBudgetMyr,
            duration_days: p.durationDays,
          },
        },
      ],
    };
  },
};
```

- [ ] **Step 3.5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts -t "X2"`
Expected: PASS — the two new specs pass; the existing `X2 emits the experiment.design call from run params` spec FAILS because we no longer read from `run.params`.

- [ ] **Step 3.6: Update the existing `X2 emits the experiment.design call` spec**

Edit `packages/orchestrator/src/stages/experiment.test.ts` — find the existing spec `"X2 emits the experiment.design call from run params"` and replace it with the memo-shaped version:

```ts
  it("X2 emits the experiment.design call from the synthesize memo", () => {
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear", "aspiration"],
        personas: [], topCreatives: {}, hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "fear beats hope",
          factors: [{ name: "angle", levels: ["fear", "aspiration"] }],
          holdConstant: [], primaryMetric: "cpa",
          dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
      doneStep("X1-query", [[], [], []]),
    ]);
    const step = experimentStage.steps[1]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]!.tool).toBe("mcp__experiment__design");
  });
```

- [ ] **Step 3.7: Re-run all experiment tests to verify**

Run: `pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts`
Expected: PASS — all X1/X2/X3 specs pass with the memo-shaped flow.

(No commit yet — Task 5 closes C2.)

---

## Task 4: X3-write legitimate-skip in `build` + `verify` (TDD)

**Files:**
- Modify: `packages/orchestrator/src/stages/experiment.ts:125-170` (the `x3Write` block)
- Modify: `packages/orchestrator/src/stages/experiment.test.ts`

- [ ] **Step 4.1: Write the failing tests for X3 legitimate-skip**

Add to `packages/orchestrator/src/stages/experiment.test.ts` (after the existing X3 specs):

```ts
  it("X3 no-ops when synthesize memo carries no experimentParams", () => {
    const run = runWith([
      doneStep("S1-reason", { schemaVersion: 2, runId: "run_e", memoId: "m1",
                              recommendedAngles: ["solo"], personas: [], topCreatives: {},
                              hypothesisIds: [], banditAllocation: {} }),
      doneStep("X1-query", [[], [], []]),
      doneStep("X2-design", [{ cells: [] }]),
    ]);
    const step = experimentStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(0);
  });

  it("X3.verify accepts the legitimate-skip path (no row + no cells = ok)", () => {
    const run = runWith([
      doneStep("S1-reason", { schemaVersion: 2, runId: "run_e", memoId: "m1",
                              recommendedAngles: ["solo"], personas: [], topCreatives: {},
                              hypothesisIds: [], banditAllocation: {} }),
      doneStep("X1-query", [[], [], []]),
      doneStep("X2-design", [{ cells: [] }]),
    ]);
    const x3 = experimentStage.steps[2]!;
    const result = x3.verify!(run, []);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts -t "X3 no-ops" -t "X3.verify accepts the legitimate-skip"`
Expected: FAIL — current X3 builds the row even with empty experimentParams; the verifier rejects no-cells.

- [ ] **Step 4.3: Patch `x3Write.build` with the legitimate-skip branch**

Edit `packages/orchestrator/src/stages/experiment.ts` — inside `x3Write.build`, after the existing `experimentExists` check, add:

```ts
const x3Write: StepSpec = {
  id: "X3-write",
  kind: "write",
  build: (run): Step => {
    if (experimentExists(run)) {
      return { kind: "write", stepId: "X3-write", calls: [] };
    }
    if (experimentDeclined(run)) {                              // ← new
      return { kind: "write", stepId: "X3-write", calls: [] };  // ← new
    }
    const cells = allocatedCellsFor(run);
    // ... rest unchanged
```

- [ ] **Step 4.4: Patch `x3Write.verify` with the same skip branch**

Inside `x3Write.verify` (same file, ~line 164):

```ts
  verify: (run, result): VerifyResult => {
    if (experimentExists(run)) return { ok: true, problems: [] };
    if (experimentDeclined(run)) return { ok: true, problems: [] };  // ← new
    const calls = Array.isArray(result) ? result : [];
    const rowCreated = calls.length > 0 && calls[0] !== null && calls[0] !== undefined;
    return verifyExperiment(allocatedCellsFor(run), rowCreated);
  },
```

- [ ] **Step 4.5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts -t "X3"`
Expected: PASS — all X3 specs (existing + 2 new) pass.

---

## Task 5: Delete the legacy `interface LegacyExperimentParams`; close C2

**Files:**
- Modify: `packages/orchestrator/src/stages/experiment.ts:19-26` (remove the renamed interface)

- [ ] **Step 5.1: Delete the legacy interface**

Edit `packages/orchestrator/src/stages/experiment.ts` — delete lines 18–26 (the `/** @deprecated */ interface LegacyExperimentParams { ... }` block from Task 2). Verify no callers remain.

- [ ] **Step 5.2: Search for any straggler references**

Run: `grep -rn "LegacyExperimentParams\|run\.params as unknown as Experiment" packages/`
Expected: zero output. If anything matches, fix it before continuing.

- [ ] **Step 5.3: Run all orchestrator tests + full build**

Run: `pnpm -r build && pnpm vitest run packages/orchestrator`
Expected: PASS — every orchestrator test green.

- [ ] **Step 5.4: Commit C2**

```bash
git add packages/orchestrator/src/stages/experiment.ts packages/orchestrator/src/stages/experiment.test.ts
git commit -m "feat(experiment): read params from synthesize memo, not run.params

X2-design and X3-write read experimentParams from the resolved S1-reason
step result via memoParams(). When the block is absent (Brain declined,
cold-start), both steps no-op and the run flows past experiment into
distribute. Legacy run.params cast deleted."
```

---

## Task 6: Verifier hardening — `verifyExperimentParams` (TDD)

**Files:**
- Modify: `packages/orchestrator/src/verifiers/verify-synthesize.ts`
- Modify: `packages/orchestrator/src/verifiers/verify-synthesize.test.ts`

- [ ] **Step 6.1: Write the 6 new failing tests**

Edit `packages/orchestrator/src/verifiers/verify-synthesize.test.ts` — replace the file contents with:

```ts
import { describe, it, expect } from "vitest";
import { verifySynthesize } from "./verify-synthesize.js";

const validMemo = {
  schemaVersion: 2 as const,
  runId: "run_x",
  memoId: "memo_x",
  recommendedAngles: ["fear", "aspiration"],
  personas: [],
  topCreatives: {},
  hypothesisIds: [],
  banditAllocation: {},
};

const validParams = {
  hypothesis: "fear beats hope",
  factors: [{ name: "angle", levels: ["fear", "aspiration"] }],
  holdConstant: [],
  primaryMetric: "cpa",
  dailyBudgetMyr: 200,
  durationDays: 7,
};

describe("verifySynthesize", () => {
  it("passes a Decision Memo carrying recommendedAngles", () => {
    expect(verifySynthesize({ ...validMemo })).toEqual({ ok: true, problems: [] });
  });

  it("fails a null / non-object result", () => {
    expect(verifySynthesize(null).ok).toBe(false);
    expect(verifySynthesize("memo").ok).toBe(false);
  });

  it("fails a Memo with no recommendedAngles", () => {
    expect(verifySynthesize({}).ok).toBe(false);
    expect(verifySynthesize({ recommendedAngles: [] }).ok).toBe(false);
  });

  // --- new: experimentParams shape ---

  it("passes a memo without experimentParams (legitimate-skip)", () => {
    expect(verifySynthesize({ ...validMemo })).toEqual({ ok: true, problems: [] });
  });

  it("passes a memo with a valid experimentParams block", () => {
    expect(verifySynthesize({ ...validMemo, experimentParams: validParams }))
      .toEqual({ ok: true, problems: [] });
  });

  it("fails on missing/empty hypothesis", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: { ...validParams, hypothesis: "" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/hypothesis/);
  });

  it("fails on factors with <2 levels", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: {
      ...validParams, factors: [{ name: "angle", levels: ["solo"] }] } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/levels/);
  });

  it("fails on unknown primaryMetric", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: {
      ...validParams, primaryMetric: "bogus" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/primaryMetric/);
  });

  it("fails on non-positive dailyBudgetMyr / durationDays", () => {
    const r1 = verifySynthesize({ ...validMemo, experimentParams: { ...validParams, dailyBudgetMyr: 0 } });
    expect(r1.ok).toBe(false);
    expect(r1.problems.join(" ")).toMatch(/dailyBudgetMyr/);

    const r2 = verifySynthesize({ ...validMemo, experimentParams: { ...validParams, durationDays: -1 } });
    expect(r2.ok).toBe(false);
    expect(r2.problems.join(" ")).toMatch(/durationDays/);
  });

  it("fails on holdConstant not an array", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: {
      ...validParams, holdConstant: "not-an-array" as unknown as string[] } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/holdConstant/);
  });
});
```

- [ ] **Step 6.2: Run the tests to verify the new specs fail**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-synthesize.test.ts`
Expected: FAIL — the 6 new experimentParams specs fail; the 3 original specs still pass.

- [ ] **Step 6.3: Implement `verifyExperimentParams`**

Replace the contents of `packages/orchestrator/src/verifiers/verify-synthesize.ts` with:

```ts
import type { VerifyResult } from "../types.js";

/**
 * Synthesize-stage acceptance test. Two layers:
 *
 *   (1) The memo must declare recommendedAngles[] non-empty (existing).
 *   (2) When the memo carries experimentParams, the block must be shape-correct
 *       (new). Absent block = legitimate-skip path (Brain declined / cold-start).
 *       The experiment stage detects absence via experimentDeclined() and no-ops.
 */
export interface DecisionMemo {
  recommendedAngles?: unknown;
  experimentParams?: unknown;
}

const VALID_METRICS = new Set(["cpa", "hook_rate", "thumbstop", "ctr"]);

function verifyExperimentParams(p: unknown): string[] {
  const problems: string[] = [];
  if (p === null || typeof p !== "object") {
    return ["experimentParams must be an object"];
  }
  const o = p as Record<string, unknown>;

  if (typeof o.hypothesis !== "string" || o.hypothesis.length === 0) {
    problems.push("experimentParams.hypothesis must be a non-empty string");
  }

  if (!Array.isArray(o.factors) || o.factors.length === 0) {
    problems.push("experimentParams.factors must be a non-empty array");
  } else {
    o.factors.forEach((f, i) => {
      if (f === null || typeof f !== "object") {
        problems.push(`experimentParams.factors[${i}] must be an object`);
        return;
      }
      const fr = f as { name?: unknown; levels?: unknown };
      if (typeof fr.name !== "string" || fr.name.length === 0) {
        problems.push(`experimentParams.factors[${i}].name must be a non-empty string`);
      }
      if (!Array.isArray(fr.levels) || fr.levels.length < 2) {
        problems.push(
          `experimentParams.factors[${i}].levels must be ≥2 strings (single level = no test)`,
        );
      }
    });
  }

  if (!Array.isArray(o.holdConstant)) {
    problems.push("experimentParams.holdConstant must be an array (use [] when nothing held)");
  }

  if (typeof o.primaryMetric !== "string" || !VALID_METRICS.has(o.primaryMetric)) {
    problems.push(
      `experimentParams.primaryMetric must be one of ${[...VALID_METRICS].join("|")}`,
    );
  }

  if (typeof o.dailyBudgetMyr !== "number" || o.dailyBudgetMyr <= 0) {
    problems.push("experimentParams.dailyBudgetMyr must be a positive number");
  }

  if (typeof o.durationDays !== "number" || o.durationDays <= 0) {
    problems.push("experimentParams.durationDays must be a positive number");
  }

  return problems;
}

export function verifySynthesize(memo: unknown): VerifyResult {
  if (memo === null || typeof memo !== "object") {
    return { ok: false, problems: ["synthesize produced no Decision Memo"] };
  }
  const m = memo as DecisionMemo;

  const angles = m.recommendedAngles;
  if (!Array.isArray(angles) || angles.length === 0) {
    return { ok: false, problems: ["Decision Memo carries no recommendedAngles"] };
  }

  // experimentParams is optional (cold-start escape). Validate only when present.
  if (m.experimentParams !== undefined) {
    const problems = verifyExperimentParams(m.experimentParams);
    if (problems.length > 0) return { ok: false, problems };
  }

  return { ok: true, problems: [] };
}
```

- [ ] **Step 6.4: Run all verifier tests to verify they pass**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-synthesize.test.ts`
Expected: PASS — all 10 specs (3 existing + 7 new) pass.

- [ ] **Step 6.5: Full workspace test sweep**

Run: `pnpm -r build && pnpm vitest run`
Expected: PASS — no regressions anywhere.

- [ ] **Step 6.6: Commit C3 (part 1)**

```bash
git add packages/orchestrator/src/verifiers/verify-synthesize.ts packages/orchestrator/src/verifiers/verify-synthesize.test.ts
git commit -m "feat(verify): assert experimentParams shape on Decision Memo

When the synthesize memo carries an experimentParams block, validate it
against the experiment library's contract (hypothesis non-empty, factors
≥2 levels per axis, primaryMetric in {cpa,hook_rate,thumbstop,ctr},
positive budget + duration, holdConstant array). Absent block remains
the legitimate-skip path; the verifier passes. Closes B-016 for the
synthesize slice."
```

---

## Task 7: Brain prompt update — `.claude/agents/brain.md`

**Files:**
- Modify: `.claude/agents/brain.md` (§B step 9 EMIT, §C row 10, Hard rules)

- [ ] **Step 7.1: Edit §B-step-9 EMIT instruction**

Open `.claude/agents/brain.md`. Find this block (around line 130, the `### 9. EMIT` section, step 3):

```text
3. **Persist the full Decision Memo as your step result.** Call:
   ```
   mcp__orchestrator__write_step_result({
     runId,
     stepId: "S1-reason",
     payload: <the full Decision Memo as a literal JSON object — runId, memoId,
              recommendedAngles, personas, topCreatives, hypothesisIds[],
              banditAllocation, notes, ... — DO NOT JSON.stringify it. The MCP
              boundary encodes the call for you. A pre-stringified payload lands
              as a JSONB scalar string and breaks the verifier.>
   })
   ```
```

Replace it with this (note the addition of `experimentParams` to the payload field list AND a new "Construct experimentParams" sub-block immediately after):

```text
3. **Persist the full Decision Memo as your step result.** Call:
   ```
   mcp__orchestrator__write_step_result({
     runId,
     stepId: "S1-reason",
     payload: <the full Decision Memo as a literal JSON object — runId, memoId,
              recommendedAngles, personas, topCreatives, hypothesisIds[],
              banditAllocation, experimentParams, notes, ... — DO NOT
              JSON.stringify it. The MCP boundary encodes the call for you.
              A pre-stringified payload lands as a JSONB scalar string and
              breaks the verifier.>
   })
   ```

   The `experimentParams` block is constructed as follows:

   ```text
   experimentParams: {
     hypothesis: <top Recommended Action's hypothesis sentence>,
     factors: [{ name: "angle", levels: recommendedAngles }],
     holdConstant: [],
     primaryMetric: "cpa",
     dailyBudgetMyr: <bandit_allocate input dailyBudgetMyr, default 200>,
     durationDays: <bandit_allocate input durationDays, default 7>,
   }
   ```

   You already computed `recommendedAngles` (step 7 CHOOSE) and the budget
   inputs (step 8 ALLOCATE). This block re-emits them in the experiment
   library's shape. **No new strategic reasoning required.**

   **Cold-start escape:** if `recommendedAngles.length < 2`, do NOT include
   `experimentParams` in the payload — surface a warning in `notes` instead.
   A single-level factor degenerates to no test; the experiment stage detects
   the absent block and takes the legitimate-skip path.
```

- [ ] **Step 7.2: Edit §C structure table — add row 10**

Find the §C table (titled "Decision Memo v2 structure", with 9 rows). Add row 10:

```markdown
| 10 | Experiment Params (factors / budget / metric for X2-design) | inline in payload, no Notion property |
```

- [ ] **Step 7.3: Add the new Hard Rule bullet**

Find the `## Hard rules` section (line ~217). The "Beyond the slices:" sub-section lists existing rules. After the existing bullets and before the closing sentence ("You are the loop's strategist..."), insert:

```markdown
- **`experimentParams.factors[0].levels` must have ≥2 entries.** A single-level factor degenerates to no test. If you have only one recommended angle, do not emit `experimentParams`; surface a warning in `notes` instead. The experiment stage detects the absent block and takes the legitimate-skip path so the loop still completes.
```

- [ ] **Step 7.4: Sanity-grep for the changes**

Run: `grep -n "experimentParams" .claude/agents/brain.md`
Expected: ≥4 matches (the 3 you added + any pre-existing — there should be none pre-existing, so exactly 3 if §C row text says "Experiment Params").

- [ ] **Step 7.5: Commit C3 (part 2)**

```bash
git add .claude/agents/brain.md
git commit -m "feat(brain): emit experimentParams in §B-step-9 EMIT

Brain emits a structured experimentParams block alongside the existing
Decision Memo fields. X2-design reads from the resolved S1-reason step
result. Cold-start (single recommended angle) skips the block; the
experiment stage's legitimate-skip path lets the loop complete. Closes
E-035."
```

---

## Task 8: TASKS.md — close E-035, open dormant E-036/037/038/039/040/041

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 8.1: Read the current E-035 entry to understand the format**

Run: `grep -nA 20 "^### E-035" TASKS.md`
Expected: the existing E-035 block; note its `Status:` line format and indentation.

- [ ] **Step 8.2: Mark E-035 as shipped**

Edit `TASKS.md` — change the `### E-035` heading to:

```markdown
### E-035 `v1.5` `P1` `agent` `orchestrator` `SHIPPED 2026-05-26` — Brain → ExperimentParams
```

…and below the existing body, append:

```markdown
- **Shipped 2026-05-26** in Brain Initiative Phase 0 (commits C1+C2+C3 on `feat/brain-experiment-params`). See `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §4 and `docs/superpowers/plans/2026-05-26-brain-initiative-phase-0.md`.
```

- [ ] **Step 8.3: Open the six dormant follow-up entries**

In the "Open enhancements" section of `TASKS.md`, after the last existing E-### entry, append the following six entries verbatim:

```markdown
### E-036 `v1.5` `P3` `agent` `orchestrator` `BlockedBy: Brain Initiative Phase 3` — Critic step in brief stage
**The seam.** Apply the generic `kind: "critic"` step (shipped in Brain Initiative Phase 3) to `verify-brief.ts`. The structural verifier admits Briefs that pass shape checks but may fail strategic alignment with the Decision Memo.

**Trigger to re-open**: ≥2 cycles where brief-writer emitted Briefs that passed structural verify but were rejected at HG1 for strategic mismatch (or vice versa).

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Doctrine in ADR-026.

### E-037 `v1.5` `P3` `agent` `orchestrator` `BlockedBy: Brain Initiative Phase 3` — Critic step in produce stage
**The seam.** Apply the generic `kind: "critic"` step to `verify-produce.ts`. Creative Variants can pass derived-spec checks while still being tonally incoherent across the four creatives a Script decomposes into.

**Trigger to re-open**: ≥2 cycles where Creative Variants passed all derived spec checks but were rejected at HG3 for tonal incoherence.

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Doctrine in ADR-026.

### E-038 `v1.5` `P3` `agent` `orchestrator` `BlockedBy: Brain Initiative Phase 3` — Critic step in distribute stage
**The seam.** Apply the generic `kind: "critic"` step to `verify-distribute.ts`. The dry-run path admits distributions that compile but might be paused-by-design when the underlying targeting / placement / asset config has a critic-detectable flaw.

**Trigger to re-open**: ≥1 cycle where distribution went out paused-by-design but a critic would have prevented the dry-run from being submitted at all.

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Doctrine in ADR-026.

### E-039 `v2` `P3` `agent` `BlockedBy: Brain Initiative Phase 3` — Multi-factor experiment design (angle × persona)
**The seam.** The `experimentParams` schema shipped in Phase 0 accepts `factors: Array<{name, levels[]}>` from day one. Brain v3 (Phase 2) only emits a single-factor `"angle"` axis. When Brain v3 is stable across ≥10 cycles and the calibration suite shows a graduation-rate plateau, teach Brain to emit `angle × persona` (or similar two-axis) designs.

**Trigger to re-open**: Brain v3 stable across ≥10 cycles; calibration suite shows graduation_rate plateau (3 cycles with no graduation deltas).

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Engine + verifier already accept the wider shape; this is a Brain-prompt-only upgrade.

### E-040 `v3.1` `P3` `agent` `BlockedBy: Brain Initiative Phase 3` — Cross-channel critic debate
**The seam.** Brain v3 (Phase 2) constrains the debate to intra-channel only. If the judge picks 3 Recommended Actions that don't fit together as a portfolio, add a Phase 4.5 cross-channel critic between R2 and the judge.

**Trigger to re-open**: Portfolio coherence flagged at HG1 in ≥3 consecutive cycles ("Brain picked 3 actions but they don't fit together").

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11.

### E-041 `vfuture` `P3` `agent` `BlockedBy: Brain Initiative Phase 3` — DSPy-style auto-tuning of critic prompts
**The seam.** When the critic over-attacks (attacks the judge ignored AND the actual outcome landed in the original CI ≥40% across ≥20 cycles), the critic prompt itself needs tuning. Use DSPy or equivalent to learn the critic prompt from calibration scores.

**Trigger to re-open**: Critic over-attack rate ≥40% across ≥20 cycles.

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Orthogonal infrastructure.
```

- [ ] **Step 8.4: Update the Status header**

Edit the `## Status (as of YYYY-MM-DD)` line near the top of `TASKS.md`. Change the date to today (2026-05-26) and update the "Open" enum to include E-036/E-037/E-038/E-039/E-040/E-041 as new blocked entries:

```markdown
## Status (as of 2026-05-26)
```

Update the relevant bullet (the one starting `- **Open**:`):

```markdown
- **Open**: 4 bugs — B-005 (P1); B-010 (P1, fix landed, `/distribute` dry-run unverified); B-015 (P3, superseded by ADR-023's path-aware substitution); B-016 (P1, content slice fixed, rest open) · 18 enhancements (E-034) + E-029-followup (enum-drift audit) + 6 new dormant Brain-Initiative-tail entries (E-036/E-037/E-038/E-039/E-040/E-041, `BlockedBy: Brain Initiative Phase 3`). E-035 shipped 2026-05-26 in Brain Initiative Phase 0.
```

Add a new top-line achievement bullet right after the existing `ADR-023 shipped` bullet:

```markdown
- **Brain Initiative Phase 0 shipped 2026-05-26** — `experimentParams` wired from Decision Memo into X2-design; `/loop` cycle no longer halts at "factors must be non-empty". See `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §4 and the umbrella spec for Phases 1–3.
```

- [ ] **Step 8.5: Commit C3 (part 3) — close TASKS bookkeeping**

```bash
git add TASKS.md
git commit -m "chore(tasks): close E-035; open 6 dormant Brain Initiative Phase 3 follow-ups

E-035 shipped in Brain Initiative Phase 0. Six new dormant enhancements
(E-036/E-037/E-038/E-039/E-040/E-041) opened blocked by Phase 3; each
has an explicit re-open trigger condition per umbrella spec §11."
```

---

## Task 9: Delete the superseded specs

**Files:**
- Delete: `docs/superpowers/specs/2026-05-24-brain-moe-critic-topology-design.html`
- Delete: `docs/superpowers/specs/2026-05-25-brain-experiment-params-design.html`
- Delete: `docs/superpowers/specs/2026-05-25-brain-experiment-params-design.md`

- [ ] **Step 9.1: Delete the three files**

```bash
git rm docs/superpowers/specs/2026-05-24-brain-moe-critic-topology-design.html \
       docs/superpowers/specs/2026-05-25-brain-experiment-params-design.html \
       docs/superpowers/specs/2026-05-25-brain-experiment-params-design.md
```

- [ ] **Step 9.2: Confirm the umbrella spec is the only remaining brain-* spec**

Run: `ls docs/superpowers/specs/ | grep -i brain`
Expected: only `2026-05-26-brain-initiative-design.html` and `2026-05-26-brain-initiative-design.html`.

- [ ] **Step 9.3: Commit the deletes**

```bash
git commit -m "chore(specs): delete superseded brain specs

The Brain Initiative umbrella spec (2026-05-26) replaces both the
MoE-Critic topology spec (2026-05-24) and the experimentParams spec
(2026-05-25). Old specs are deleted; their content is folded into
the umbrella's §4 (Phase 0) and §6 (Phase 2)."
```

---

## Task 10: Integration verification — one `/loop` cycle reaches HG4

This is the Phase 0 merge gate (umbrella spec §4.10). No code changes; observation only.

- [ ] **Step 10.1: Start the local OS — Postgres, the orchestrator daemon, the review app**

```bash
docker compose up -d postgres
pnpm dev:webapp &     # review UI at localhost:3030
```

Verify Postgres is healthy: `docker compose ps postgres` should show `healthy`.

- [ ] **Step 10.2: Wipe orchestrator state for a clean cold-start cycle**

```bash
# Truncate the SQLite orchestrator file's run/step rows.
# (Per recent commit d1aa8f5 the webapp truncates in place.)
pnpm orchestrator:truncate-runs
```

(If the script doesn't exist, run the equivalent SQL: `sqlite3 data/engineerdad.sqlite "DELETE FROM runs; DELETE FROM step_results;"`.)

- [ ] **Step 10.3: Kick a cold-start cycle**

Open Claude Code in this repo and run the slash command:

```
/loop-once
```

Wait for the orchestrator to drive through tracking → analytics → synthesize → brief → HG1. Approve any Briefs at `http://localhost:3030/review/briefs`.

- [ ] **Step 10.4: Continue through HG2 → HG3 → HG4**

After HG1 approval, run `/content` to advance through content stage to HG2. Repeat: `/produce` → HG3 → `/distribute` (which now includes the experiment + schedule stages) → HG4.

- [ ] **Step 10.5: Confirm `experimentParams` is populated on the memo**

Query Postgres directly:

```bash
docker compose exec postgres psql -U postgres -d engineerdad -c \
  "select run_id, experiment_params is not null as has_params,
          jsonb_array_length(experiment_params->'factors') as n_factors
   from performance_reports
   order by created_at desc limit 1;"
```

Expected: one row, `has_params = true`, `n_factors = 1` (single-factor "angle").

- [ ] **Step 10.6: Confirm `experiment_id` is attached to the run's Hypotheses**

```bash
docker compose exec postgres psql -U postgres -d engineerdad -c \
  "select id, test_experiment from hypotheses
   where run_id = (select run_id from performance_reports
                   order by created_at desc limit 1);"
```

Expected: all rows have `test_experiment` set (non-null), pointing at the Experiments row created by X3-write.

- [ ] **Step 10.7: Confirm `/status` shows the run at distribute → HG4**

```bash
# Whatever the project's status command is — the Status header in CLAUDE.md
# references /status as the dashboard.
```

Run: `/status` in Claude Code.
Expected: the run's stage is `distribute` and its status is `awaiting-gate` (HG4).

- [ ] **Step 10.8: (Cold-start fallback test) Force the legitimate-skip path**

If the Brain emitted only one recommended angle and `experimentParams` was therefore *absent*, X2 + X3 should have no-op'd. Verify with:

```bash
docker compose exec postgres psql -U postgres -d engineerdad -c \
  "select stage, status from runs order by created_at desc limit 1;"
```

Expected: `stage = distribute`, `status = awaiting-gate`. The run reached HG4 even on the skip path.

- [ ] **Step 10.9: Push branch + open PR**

```bash
git push -u origin feat/brain-experiment-params

gh pr create --title "feat: Brain Initiative Phase 0 — experimentParams + umbrella spec" --body "$(cat <<'EOF'
## Summary

- Wires `experimentParams` from Brain's Decision Memo into `X2-design` so the `/loop` cycle reaches HG4 instead of halting at `factors must be non-empty`.
- Introduces the umbrella `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` (4-phase Brain programme) and supersedes the two prior brain specs.
- Closes E-035; opens E-036–E-041 dormant entries blocked by Phase 3.

## Test plan
- [x] `pnpm -r build` passes
- [x] `pnpm vitest run` passes (10 verify-synthesize specs, 7 experiment specs)
- [x] One `/loop-once` cycle reaches HG4 with `experiment_params is not null` on the latest `performance_reports` row, OR with the legitimate-skip path on cold-start
- [x] No regressions in other orchestrator tests

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Phase 0 ships. The branch may be renamed to `feat/brain-initiative` for the squash-merge target; not required.

---

## Self-Review

After writing the plan, checking against the spec §4:

**Spec coverage:**
- §4.1 problem → described in Goal + Task 3
- §4.2 decisions (ownership, factor model, no run.params mutation, legitimate-skip) → Tasks 1, 3, 4
- §4.3 type lineage (`packages/shared/src/types/brain.ts`) → Task 1
- §4.4 brain prompt change → Task 7
- §4.5 engine wiring (`experiment.ts`) → Tasks 2–5
- §4.6 verifier extension → Task 6
- §4.7 commit slicing (C1/C2/C3) → committed at end of Task 1 (C1), Task 5 (C2), Tasks 6–8 (C3)
- §4.8 tests → Tasks 1, 3, 4, 6 (all TDD)
- §4.9 backward compat (run_1779696355) → verified implicitly in Task 10
- §4.10 merge gate → Task 10
- Supersession of old specs → Task 9
- §11 rollover TASKS entries → Task 8

All §4 sub-sections accounted for. No spec gaps.

**Placeholder scan:** No "TBD", "TODO", "fill in", or "similar to Task N" in any step. Every code step shows actual code. Every command step shows the actual command + expected output.

**Type consistency:** `memoParams` returns `ExperimentParams | undefined` in Task 3 and is referenced verbatim in Task 4. `verifyExperimentParams` defined in Task 6 and referenced only inside `verify-synthesize.ts`. `DecisionMemoV2` defined in Task 1, used in Task 3. `experimentDeclined` is defined in Task 3, used in Task 4. All consistent.

No gaps. Plan complete.

---

*Brain Initiative Phase 0 implementation plan · 2026-05-26 · 10 tasks · ~1–2 days focused work · ships from `feat/brain-experiment-params` as one PR with 3 logical commits (C1/C2/C3) plus chore commits.*
