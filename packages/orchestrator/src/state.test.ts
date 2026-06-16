import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createRun,
  loadRunState,
  upsertStep,
  setRunStage,
  listRuns,
} from "./state.js";
import { closeDb } from "./db.js";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import type { RunStepState } from "./types.js";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

describe("createRun + loadRunState", () => {
  it("round-trips stage, status, and params", async () => {
    await createRun("run_1", "fixture", { lang: "en", count: 3 });
    const state = await loadRunState("run_1");
    expect(state).not.toBeNull();
    expect(state!.runId).toBe("run_1");
    expect(state!.stage).toBe("fixture");
    expect(state!.status).toBe("active");
    expect(state!.params).toEqual({ lang: "en", count: 3 });
    expect(state!.steps).toEqual([]);
  });

  it("returns null for an unknown runId", async () => {
    expect(await loadRunState("run_missing")).toBeNull();
  });

  it("preserves nested params JSON across the round-trip", async () => {
    await createRun("run_2", "fixture", { briefs: [{ id: "b1" }, { id: "b2" }] });
    const state = await loadRunState("run_2");
    expect(state!.params).toEqual({ briefs: [{ id: "b1" }, { id: "b2" }] });
  });
});

describe("upsertStep + setRunStage + listRuns", () => {
  const step = (over: Partial<RunStepState> = {}): RunStepState => ({
    stepId: "s1",
    stage: "fixture",
    status: "pending",
    result: null,
    problems: [],
    attempts: 0,
    ...over,
  });

  it("upsertStep is idempotent on (runId, stepId)", async () => {
    await createRun("run_1", "fixture", {});
    await upsertStep("run_1", step({ status: "pending" }));
    await upsertStep("run_1", step({ status: "done", result: { ok: true }, attempts: 1 }));
    const state = await loadRunState("run_1");
    expect(state!.steps).toHaveLength(1);
    expect(state!.steps[0]!.status).toBe("done");
    expect(state!.steps[0]!.result).toEqual({ ok: true });
    expect(state!.steps[0]!.attempts).toBe(1);
  });

  it("loadRunState surfaces an upserted step with problems", async () => {
    await createRun("run_1", "fixture", {});
    await upsertStep("run_1", step({ stepId: "s2", status: "failed", problems: ["bad"] }));
    const state = await loadRunState("run_1");
    expect(state!.steps[0]!.stepId).toBe("s2");
    expect(state!.steps[0]!.problems).toEqual(["bad"]);
  });

  it("setRunStage moves the run's stage and status", async () => {
    await createRun("run_1", "fixture", {});
    await setRunStage("run_1", "produce", "awaiting_gate");
    const state = await loadRunState("run_1");
    expect(state!.stage).toBe("produce");
    expect(state!.status).toBe("awaiting_gate");
  });

  it("listRuns returns every run with its step count", async () => {
    await createRun("run_a", "fixture", {});
    await createRun("run_b", "fixture", {});
    await upsertStep("run_b", step());
    const runs = await listRuns();
    expect(runs.map((r) => r.runId).sort()).toEqual(["run_a", "run_b"]);
    expect(runs.find((r) => r.runId === "run_b")!.stepCount).toBe(1);
    expect(runs.find((r) => r.runId === "run_a")!.stepCount).toBe(0);
  });
});
