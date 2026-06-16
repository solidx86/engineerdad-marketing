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
