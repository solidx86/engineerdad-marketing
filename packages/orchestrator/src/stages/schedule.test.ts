import { describe, it, expect } from "vitest";
import { scheduleStage } from "./schedule.js";
import type { RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[]): RunState {
  return {
    runId: "run_1778486942", // engine-minted: run_<epoch>
    stage: "schedule",
    status: "active",
    params: {},
    steps,
  };
}

function doneStep(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "schedule", status: "done", result, problems: [], attempts: 1 };
}

describe("scheduleStage", () => {
  it("has 2 write steps in S1..S2 order", () => {
    expect(scheduleStage.id).toBe("schedule");
    expect(scheduleStage.steps.map((s) => s.id)).toEqual(["S1-query", "S2-stamp"]);
    expect(scheduleStage.steps.map((s) => s.kind)).toEqual(["write", "write"]);
  });

  it("S1 queries approved CreativeVariants for the run", () => {
    const step = scheduleStage.steps[0]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]!.tool).toBe("mcp__store__query");
    const args = step.calls[0]!.args as { entity: string; filter: Record<string, unknown> };
    expect(args.entity).toBe("CreativeVariants");
    expect(args.filter).toEqual({
      runId: "run_1778486942",
      approvalStatus: "Approved",
    });
  });

  it("S2 emits one store.update per organic variant, stamping organicScheduledFor as a Date", () => {
    const variants = [
      { id: "p1", format: "Reel", channels: ["Meta-organic"] },
      { id: "p2", format: "Feed", channels: ["Meta-organic"] },
    ];
    const step = scheduleStage.steps[1]!.build(runWith([doneStep("S1-query", [variants])]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(2);
    expect(step.calls.every((c) => c.tool === "mcp__store__update")).toBe(true);
    const args0 = step.calls[0]!.args as {
      entity: string;
      id: string;
      props: { organicScheduledFor: unknown };
    };
    expect(args0.entity).toBe("CreativeVariants");
    expect(args0.id).toBe("p1");
    // Drizzle's timestamp column (default mode "date") serializes via
    // value.toISOString() — strings crash the codec. The stage must pass a Date.
    expect(args0.props.organicScheduledFor).toBeInstanceOf(Date);
  });

  it("S2.verify delegates to verifySchedule — ok on a fully organic run", () => {
    const variants = [{ id: "p1", format: "Reel", channels: ["Meta-organic"] }];
    const run = runWith([doneStep("S1-query", [variants])]);
    expect(scheduleStage.steps[1]!.verify!(run, []).ok).toBe(true);
  });
});
