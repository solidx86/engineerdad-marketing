import { describe, it, expect } from "vitest";
import { analyticsStage } from "./analytics.js";
import type { RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[], params: Record<string, unknown> = {}): RunState {
  return { runId: "run_a", stage: "analytics", status: "active", params, steps };
}

function doneStep(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "analytics", status: "done", result, problems: [], attempts: 1 };
}

describe("analyticsStage", () => {
  it("has 3 write steps in A1..A3 order", () => {
    expect(analyticsStage.id).toBe("analytics");
    expect(analyticsStage.steps.map((s) => s.id)).toEqual([
      "A1-ingest",
      "A2-rank",
      "A3-decay",
    ]);
    expect(analyticsStage.steps.map((s) => s.kind)).toEqual(["write", "write", "write"]);
  });

  it("A1 pulls then persists insights", () => {
    const step = analyticsStage.steps[0]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.map((c) => c.tool)).toEqual([
      "mcp__meta-ads__get_insights",
      "mcp__analytics__ingest_meta_insights",
    ]);
  });

  it("A2 ranks creatives and costs angles", () => {
    const step = analyticsStage.steps[1]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.map((c) => c.tool)).toEqual([
      "mcp__analytics__top_creatives",
      "mcp__analytics__cost_per_angle",
    ]);
  });

  it("A3 emits one decay_curve per top-3 ad_id carried from A2, then log_event", () => {
    const run = runWith([
      doneStep("A2-rank", [
        { results: [{ ad_id: "a1" }, { ad_id: "a2" }, { ad_id: "a3" }, { ad_id: "a4" }] },
        { results: [] },
      ]),
    ]);
    const step = analyticsStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.map((c) => c.tool)).toEqual([
      "mcp__analytics__decay_curve",
      "mcp__analytics__decay_curve",
      "mcp__analytics__decay_curve",
      "mcp__analytics__log_event",
    ]);
    expect(step.calls[0]!.args).toEqual({ ad_id: "a1", metric: "cpa" });
  });

  it("A3 on cold start (no top creatives) emits only log_event", () => {
    const run = runWith([doneStep("A2-rank", [{ results: [] }, { results: [] }])]);
    const step = analyticsStage.steps[2]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.map((c) => c.tool)).toEqual(["mcp__analytics__log_event"]);
  });

  it("verify passes a cold-start empty A1 result", () => {
    const v = analyticsStage.steps[0]!.verify!(runWith([]), [{ results: [] }, { ingested: 0 }]);
    expect(v.ok).toBe(true);
  });

  it("verify fails when a call returned an error", () => {
    const v = analyticsStage.steps[0]!.verify!(runWith([]), [{ isError: true }, {}]);
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });
});
