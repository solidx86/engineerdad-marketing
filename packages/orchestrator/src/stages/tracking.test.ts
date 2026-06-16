import { describe, it, expect } from "vitest";
import { trackingStage } from "./tracking.js";
import type { RunState } from "../types.js";

const run: RunState = {
  runId: "run_t",
  stage: "tracking",
  status: "active",
  params: {},
  steps: [],
};

describe("trackingStage", () => {
  it("has 2 write steps in T1..T2 order", () => {
    expect(trackingStage.id).toBe("tracking");
    expect(trackingStage.steps.map((s) => s.id)).toEqual(["T1-canary", "T2-send"]);
    expect(trackingStage.steps.map((s) => s.kind)).toEqual(["write", "write"]);
  });

  it("T1-canary fires capi_test_event with no args", () => {
    const step = trackingStage.steps[0]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]!.tool).toBe("mcp__meta-ads__capi_test_event");
    expect(step.calls[0]!.args).toEqual({});
  });

  it("T1-canary verify passes when the canary returns ok:true", () => {
    const v = trackingStage.steps[0]!.verify!(run, [{ ok: true, sample_response: {} }]);
    expect(v.ok).toBe(true);
  });

  it("T1-canary verify fails when the canary returns ok:false — the loop halt", () => {
    const v = trackingStage.steps[0]!.verify!(run, [{ ok: false, sample_response: {} }]);
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  it("T2-send fires capi_send then log_event", () => {
    const step = trackingStage.steps[1]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.map((c) => c.tool)).toEqual([
      "mcp__meta-ads__capi_send",
      "mcp__analytics__log_event",
    ]);
  });

  it("T2-send verify passes when events_received > 0", () => {
    const v = trackingStage.steps[1]!.verify!(run, [{ events_received: 1 }, {}]);
    expect(v.ok).toBe(true);
  });

  it("T2-send verify fails when events_received is 0 — the loop halt", () => {
    const v = trackingStage.steps[1]!.verify!(run, [{ events_received: 0 }, {}]);
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });
});
