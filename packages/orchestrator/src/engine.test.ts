import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { upsertStep, loadRunState } from "./state.js";
import { closeDb } from "./db.js";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { plan, verify, advance } from "./engine.js";
import type { StageDefinition, Step, VerifyResult } from "./types.js";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

/** A 2-step single-stage registry used to exercise the engine. */
const testRegistry: StageDefinition[] = [
  {
    id: "fixture",
    steps: [
      {
        id: "t1",
        kind: "spawn",
        build: (): Step => ({
          kind: "spawn",
          stepId: "t1",
          agent: "general-purpose",
          spawnPrompt: "do 1",
        }),
      },
      {
        id: "t2",
        kind: "spawn",
        build: (): Step => ({
          kind: "spawn",
          stepId: "t2",
          agent: "general-purpose",
          spawnPrompt: "do 2",
        }),
      },
    ],
  },
];

async function markDone(runId: string, stepId: string): Promise<void> {
  await upsertStep(runId, {
    stepId,
    stage: "fixture",
    status: "done",
    result: { ok: true },
    problems: [],
    attempts: 1,
  });
}

describe("plan", () => {
  it("mints a run and returns the first step on a fresh call", async () => {
    const { runId, step } = await plan({ args: "hello" }, testRegistry);
    expect(runId).toMatch(/^run_\d+$/);
    expect(step).toMatchObject({ kind: "spawn", stepId: "t1" });
  });

  it("returns the second step after the first is marked done", async () => {
    const { runId } = await plan({}, testRegistry);
    await markDone(runId, "t1");
    const { step } = await plan({ runId }, testRegistry);
    expect(step).toMatchObject({ kind: "spawn", stepId: "t2" });
  });

  it("returns {kind:'done'} once every step is done", async () => {
    const { runId } = await plan({}, testRegistry);
    await markDone(runId, "t1");
    await markDone(runId, "t2");
    const { step } = await plan({ runId }, testRegistry);
    expect(step.kind).toBe("done");
  });

  it("is deterministic on re-entry — same persisted state yields the same step", async () => {
    const { runId } = await plan({}, testRegistry);
    const a = await plan({ runId }, testRegistry);
    const b = await plan({ runId }, testRegistry);
    expect(a.step).toEqual(b.step);
    expect(a.step).toMatchObject({ stepId: "t1" });
  });

  it("parses run-creation args into typed params (B-010)", async () => {
    const { runId } = await plan({ args: "--dry-run --channels=meta-paid" }, testRegistry);
    const params = (await loadRunState(runId))!.params;
    expect(params.dryRun).toBe(true);
    expect(params.channelFilter).toEqual(["meta-paid"]);
  });
});

/** A registry whose only step carries a custom verifier. */
const customRegistry: StageDefinition[] = [
  {
    id: "fixture",
    steps: [
      {
        id: "cv1",
        kind: "spawn",
        build: (): Step => ({
          kind: "spawn",
          stepId: "cv1",
          agent: "general-purpose",
          spawnPrompt: "x",
        }),
        verify: (_run, result): VerifyResult => {
          const ok = (result as { score?: number } | null)?.score === 100;
          return ok
            ? { ok: true, problems: [] }
            : { ok: false, problems: ["score must be 100"] };
        },
      },
    ],
  },
];

describe("verify", () => {
  it("default verifier passes a normal object result", async () => {
    const { runId } = await plan({}, testRegistry);
    expect(await verify(runId, "t1", { ok: true }, testRegistry)).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("default verifier fails a null result", async () => {
    const { runId } = await plan({}, testRegistry);
    expect((await verify(runId, "t1", null, testRegistry)).ok).toBe(false);
  });

  it("default verifier fails a result carrying an error", async () => {
    const { runId } = await plan({}, testRegistry);
    const v = await verify(runId, "t1", { error: "boom" }, testRegistry);
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  it("routes to the StepSpec's custom verifier when present", async () => {
    const { runId } = await plan({}, customRegistry);
    expect((await verify(runId, "cv1", { score: 100 }, customRegistry)).ok).toBe(true);
    const bad = await verify(runId, "cv1", { score: 1 }, customRegistry);
    expect(bad.ok).toBe(false);
    expect(bad.problems).toContain("score must be 100");
  });
});

function spawnStep(id: string): Step {
  return { kind: "spawn", stepId: id, agent: "general-purpose", spawnPrompt: id };
}

/** A 2-stage registry: fixture (f1, f2) then produce (p1). */
const twoStageRegistry: StageDefinition[] = [
  {
    id: "fixture",
    steps: [
      { id: "f1", kind: "spawn", build: () => spawnStep("f1") },
      { id: "f2", kind: "spawn", build: () => spawnStep("f2") },
    ],
  },
  {
    id: "produce",
    steps: [{ id: "p1", kind: "spawn", build: () => spawnStep("p1") }],
  },
];

describe("advance", () => {
  it("keeps the stage when a mid-stage step completes", async () => {
    const { runId } = await plan({}, twoStageRegistry);
    const r = await advance(runId, "f1", { ok: true }, twoStageRegistry);
    expect(r).toEqual({ stage: "fixture", status: "active" });
  });

  it("rolls to the next stage when a stage's last step completes", async () => {
    const { runId } = await plan({}, twoStageRegistry);
    await advance(runId, "f1", { ok: true }, twoStageRegistry);
    const r = await advance(runId, "f2", { ok: true }, twoStageRegistry);
    expect(r).toEqual({ stage: "produce", status: "active" });
  });

  it("sets status done when the final stage's last step completes", async () => {
    const { runId } = await plan({}, twoStageRegistry);
    await advance(runId, "f1", { ok: true }, twoStageRegistry);
    await advance(runId, "f2", { ok: true }, twoStageRegistry);
    const r = await advance(runId, "p1", { ok: true }, twoStageRegistry);
    expect(r).toEqual({ stage: "done", status: "done" });
  });

  it("persists the step result so plan returns the next step", async () => {
    const { runId } = await plan({}, twoStageRegistry);
    await advance(runId, "f1", { value: 42 }, twoStageRegistry);
    const next = await plan({ runId }, twoStageRegistry);
    expect(next.step).toMatchObject({ stepId: "f2" });
  });
});

/** A single-stage registry whose only step is a gate. */
const gateRegistry: StageDefinition[] = [
  {
    id: "fixture",
    steps: [
      {
        id: "g1",
        kind: "gate",
        build: (): Step => ({
          kind: "gate",
          stepId: "g1",
          gate: "HGX",
          message: "awaiting gate",
          check: { tool: "mcp__store__query", args: {} },
        }),
        verify: (_run, result): VerifyResult =>
          (result as { cleared?: boolean } | null)?.cleared
            ? { ok: true, problems: [] }
            : { ok: false, problems: ["not cleared"] },
      },
    ],
  },
];

describe("plan — gate status", () => {
  it("sets status awaiting_gate when the next step is a gate", async () => {
    const { runId } = await plan({}, gateRegistry);
    expect((await loadRunState(runId))!.status).toBe("awaiting_gate");
  });

  it("keeps status active when the next step is not a gate", async () => {
    const { runId } = await plan({}, testRegistry);
    expect((await loadRunState(runId))!.status).toBe("active");
  });

  it("stays awaiting_gate on re-plan of a gated run", async () => {
    const { runId } = await plan({}, gateRegistry);
    await plan({ runId }, gateRegistry);
    expect((await loadRunState(runId))!.status).toBe("awaiting_gate");
  });
});
