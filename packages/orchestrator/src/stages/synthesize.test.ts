import { describe, it, expect } from "vitest";
import { synthesizeStage } from "./synthesize.js";
import type { RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[]): RunState {
  return { runId: "run_s", stage: "synthesize", status: "active", params: {}, steps };
}

function doneStep(stepId: string, stage: string, result: unknown): RunStepState {
  return { stepId, stage, status: "done", result, problems: [], attempts: 1 };
}

describe("synthesizeStage", () => {
  it("has a single spawn step S1-reason", () => {
    expect(synthesizeStage.id).toBe("synthesize");
    expect(synthesizeStage.steps.map((s) => s.id)).toEqual(["S1-reason"]);
    expect(synthesizeStage.steps.map((s) => s.kind)).toEqual(["spawn"]);
  });

  it("S1 spawns brain, names the runId, and forbids dispatch", () => {
    const step = synthesizeStage.steps[0]!.build(runWith([]));
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("brain");
    expect(step.spawnPrompt).toContain("run_s");
    expect(step.spawnPrompt).toContain("NOT dispatch");
    expect(step.spawnPrompt).toMatch(/not mint a run/i);
  });

  it("S1 prompt carries the analytics-stage output", () => {
    const run = runWith([doneStep("A2-rank", "analytics", [{ top: "creative-x" }])]);
    const step = synthesizeStage.steps[0]!.build(run);
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.spawnPrompt).toContain("creative-x");
  });

  it("S1.verify delegates to verifySynthesize", () => {
    const s1 = synthesizeStage.steps[0]!;
    expect(s1.verify).toBeDefined();
    expect(s1.verify!(runWith([]), { recommendedAngles: ["a"] }).ok).toBe(true);
    expect(s1.verify!(runWith([]), {}).ok).toBe(false);
  });
});
