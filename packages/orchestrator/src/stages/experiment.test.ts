import { describe, it, expect } from "vitest";
import { experimentStage, __projectExpVariantForTests as projectExpVariant } from "./experiment.js";
import type { RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[], params: Record<string, unknown> = {}): RunState {
  return { runId: "run_e", stage: "experiment", status: "active", params, steps };
}

function doneStep(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "experiment", status: "done", result, problems: [], attempts: 1 };
}

describe("experimentStage", () => {
  it("has 3 steps in X1..X3 order, all write", () => {
    expect(experimentStage.id).toBe("experiment");
    expect(experimentStage.steps.map((s) => s.id)).toEqual([
      "X1-query",
      "X2-design",
      "X3-write",
    ]);
    expect(experimentStage.steps.map((s) => s.kind)).toEqual(["write", "write", "write"]);
  });

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
      doneStep("X1-query", [[], [], [], [], []]),
    ]);
    const step = experimentStage.steps[1]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]!.tool).toBe("mcp__experiment__design");
  });

  it("X2 no-ops when synthesize memo carries no experimentParams (legitimate-skip)", () => {
    const run = runWith([
      doneStep("S1-reason", { schemaVersion: 2, runId: "run_e", memoId: "m1",
                              recommendedAngles: ["fear"], personas: [], topCreatives: {},
                              hypothesisIds: [], banditAllocation: {} }),
      doneStep("X1-query", [[], [], [], [], []]),
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
      doneStep("X1-query", [[], [], [], [], []]),
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

  it("X2 emits no calls when an Experiment already exists (idempotent)", () => {
    const run = runWith([
      doneStep("X1-query", [[], [], [{ pageId: "exp1" }], [], []]),
    ]);
    const step = experimentStage.steps[1]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(0);
  });

  it("X3 builds a store.create for the Experiments row", () => {
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear"], personas: [], topCreatives: {},
        hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "h", factors: [{ name: "angle", levels: ["fear", "hope"] }],
          holdConstant: [], primaryMetric: "cpa", dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
      doneStep("X1-query", [
        [{ id: "v1", script: "s1" }],
        [],
        [],
        [{ id: "s1", brief: "b1" }],
        [{ id: "b1", angle: "fear", budgetBucket: "70" }],
      ]),
      doneStep("X2-design", [{ cells: [{ cellId: "c1", factorLevels: { angle: "fear" } }] }]),
    ]);
    const step = experimentStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls[0]!.tool).toBe("mcp__store__create");
    const args = step.calls[0]!.args as { entity: string; props: Record<string, unknown> };
    expect(args.entity).toBe("Experiments");
    expect(args.props.runId).toBe("run_e");
  });

  it("X3 emits a Hypotheses.update per row to stamp testExperiment (B-024)", () => {
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear"], personas: [], topCreatives: {},
        hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "h", factors: [{ name: "angle", levels: ["fear", "hope"] }],
          holdConstant: [], primaryMetric: "cpa", dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
      doneStep("X1-query", [
        [{ id: "v1", script: "s1" }],
        // Hypotheses rows projected from the store carry `id`, not `pageId`.
        [{ id: "h1" }, { id: "h2" }],
        [],
        [{ id: "s1", brief: "b1" }],
        [{ id: "b1", angle: "fear", budgetBucket: "70" }],
      ]),
      doneStep("X2-design", [{ cells: [{ cellId: "c1", factorLevels: { angle: "fear" } }] }]),
    ]);
    const step = experimentStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    // 1 store.create for Experiments + 1 store.update per Hypothesis.
    expect(step.calls).toHaveLength(3);
    const updates = step.calls.slice(1) as Array<{ tool: string; args: { entity: string; id: string; props: Record<string, unknown> } }>;
    expect(updates.every((c) => c.tool === "mcp__store__update")).toBe(true);
    expect(updates.every((c) => c.args.entity === "Hypotheses")).toBe(true);
    expect(updates.map((c) => c.args.id).sort()).toEqual(["h1", "h2"]);
    expect(updates.every((c) => c.args.props.testExperiment === "$experiment.id")).toBe(true);
  });

  it("X3.verify delegates to verifyExperiment — ok on a complete carried run", () => {
    const x3 = experimentStage.steps[2]!;
    const designCells = [
      { cellId: "c1", factorLevels: { angle: "fear" } },
      { cellId: "c2", factorLevels: { angle: "hope" } },
    ];
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear", "hope"], personas: [], topCreatives: {},
        hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "h", factors: [{ name: "angle", levels: ["fear", "hope"] }],
          holdConstant: [], primaryMetric: "cpa", dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
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
      doneStep("X2-design", [{ cells: designCells }]),
    ]);
    expect(x3.verify!(run, [{ id: "exp1" }]).ok).toBe(true);
  });

  it("X3.verify fails when every cell is empty (broken)", () => {
    // Post-Task 3 tri-state: degraded (some empty cells) PASSES; only `broken`
    // (zero occupied cells) fails. This test pins the broken case.
    const x3 = experimentStage.steps[2]!;
    const designCells = [
      { cellId: "c1", factorLevels: { angle: "fear" } },
      { cellId: "c2", factorLevels: { angle: "hope" } },
    ];
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear", "hope"], personas: [], topCreatives: {},
        hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "h", factors: [{ name: "angle", levels: ["fear", "hope"] }],
          holdConstant: [], primaryMetric: "cpa", dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
      doneStep("X1-query", [
        // No variants → no cell can be occupied → broken.
        [],
        [],
        [],
        [],
        [],
      ]),
      doneStep("X2-design", [{ cells: designCells }]),
    ]);
    expect(x3.verify!(run, [{ id: "exp1" }]).ok).toBe(false);
  });

  it("X3 no-ops when synthesize memo carries no experimentParams", () => {
    const run = runWith([
      doneStep("S1-reason", { schemaVersion: 2, runId: "run_e", memoId: "m1",
                              recommendedAngles: ["solo"], personas: [], topCreatives: {},
                              hypothesisIds: [], banditAllocation: {} }),
      doneStep("X1-query", [[], [], [], [], []]),
      doneStep("X2-design", [{ cells: [] }]),
    ]);
    const step = experimentStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(0);
  });

  it("X3-write persists experimentStatus 'degraded' when 2 of 3 cells occupied", () => {
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear", "hope", "curiosity"], personas: [], topCreatives: {},
        hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "h",
          factors: [{ name: "angle", levels: ["fear", "hope", "curiosity"] }],
          holdConstant: [], primaryMetric: "cpa", dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
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
      doneStep("X2-design", [{ cells: [
        { cellId: "c1", factorLevels: { angle: "fear" } },
        { cellId: "c2", factorLevels: { angle: "hope" } },
        { cellId: "c3", factorLevels: { angle: "curiosity" } }, // no matching variant
      ] }]),
    ]);
    const step = experimentStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write step");
    const createCall = step.calls.find(
      (c) => c.tool === "mcp__store__create" && c.label === "experiment",
    );
    expect(createCall).toBeDefined();
    const props = (createCall!.args as { props: Record<string, unknown> }).props;
    expect(props.experimentStatus).toBe("degraded");
  });

  it("X3-write persists experimentStatus 'full' when every cell is occupied", () => {
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear", "hope"], personas: [], topCreatives: {},
        hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "h",
          factors: [{ name: "angle", levels: ["fear", "hope"] }],
          holdConstant: [], primaryMetric: "cpa", dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
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
      doneStep("X2-design", [{ cells: [
        { cellId: "c1", factorLevels: { angle: "fear" } },
        { cellId: "c2", factorLevels: { angle: "hope" } },
      ] }]),
    ]);
    const step = experimentStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write step");
    const createCall = step.calls.find(
      (c) => c.tool === "mcp__store__create" && c.label === "experiment",
    );
    expect(createCall).toBeDefined();
    const props = (createCall!.args as { props: Record<string, unknown> }).props;
    expect(props.experimentStatus).toBe("full");
  });

  it("X3-write persists experimentStatus 'single-cell' when exactly 1 of 3 occupied", () => {
    const run = runWith([
      doneStep("S1-reason", {
        schemaVersion: 2, runId: "run_e", memoId: "m1",
        recommendedAngles: ["fear", "hope", "curiosity"], personas: [], topCreatives: {},
        hypothesisIds: [], banditAllocation: {},
        experimentParams: {
          hypothesis: "h",
          factors: [{ name: "angle", levels: ["fear", "hope", "curiosity"] }],
          holdConstant: [], primaryMetric: "cpa", dailyBudgetMyr: 200, durationDays: 7,
        },
      }),
      doneStep("X1-query", [
        [{ id: "v1", script: "s1" }],
        [],
        [],
        [{ id: "s1", brief: "b1" }],
        [{ id: "b1", angle: "fear", budgetBucket: "70" }],
      ]),
      doneStep("X2-design", [{ cells: [
        { cellId: "c1", factorLevels: { angle: "fear" } },
        { cellId: "c2", factorLevels: { angle: "hope" } },
        { cellId: "c3", factorLevels: { angle: "curiosity" } },
      ] }]),
    ]);
    const step = experimentStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write step");
    const createCall = step.calls.find(
      (c) => c.tool === "mcp__store__create" && c.label === "experiment",
    );
    expect(createCall).toBeDefined();
    const props = (createCall!.args as { props: Record<string, unknown> }).props;
    expect(props.experimentStatus).toBe("single-cell");
  });

  it("X3.verify accepts the legitimate-skip path (no row + no cells = ok)", () => {
    const run = runWith([
      doneStep("S1-reason", { schemaVersion: 2, runId: "run_e", memoId: "m1",
                              recommendedAngles: ["solo"], personas: [], topCreatives: {},
                              hypothesisIds: [], banditAllocation: {} }),
      doneStep("X1-query", [[], [], [], [], []]),
      doneStep("X2-design", [{ cells: [] }]),
    ]);
    const x3 = experimentStage.steps[2]!;
    const result = x3.verify!(run, []);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });
});

describe("projectExpVariant", () => {
  it("happy path — variant→script→brief resolves angle + budgetBucket", () => {
    const scripts = new Map([["s1", { brief: "b1" }]]);
    const briefs = new Map([["b1", { angle: "fear", budgetBucket: "70" }]]);
    const out = projectExpVariant({ id: "v1", script: "s1" }, scripts, briefs);
    expect(out).toEqual({ pageId: "v1", factorTags: { angle: "fear" }, budgetBucket: "70" });
  });

  it("missing script link — empty factorTags, null bucket, no throw", () => {
    const scripts = new Map<string, { brief?: string | null }>();
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
