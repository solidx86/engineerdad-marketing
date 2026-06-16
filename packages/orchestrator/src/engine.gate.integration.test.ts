import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { loadRunState } from "./state.js";
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

/** A stage: one spawn step, then a passable gate whose check reports {cleared}. */
const gatedRegistry: StageDefinition[] = [
  {
    id: "fixture",
    steps: [
      {
        id: "work",
        kind: "spawn",
        build: (): Step => ({
          kind: "spawn",
          stepId: "work",
          agent: "general-purpose",
          spawnPrompt: "do work",
        }),
      },
      {
        id: "hg",
        kind: "gate",
        build: (): Step => ({
          kind: "gate",
          stepId: "hg",
          gate: "HGX",
          message: "awaiting HGX",
          check: { tool: "mcp__store__query", args: {} },
        }),
        verify: (_run, result): VerifyResult =>
          (result as { cleared?: boolean } | null)?.cleared
            ? { ok: true, problems: [] }
            : { ok: false, problems: ["HGX not cleared"] },
      },
    ],
  },
];

/** A stage whose only step is a terminal gate (no check). */
const terminalGateRegistry: StageDefinition[] = [
  {
    id: "fixture",
    steps: [
      {
        id: "term",
        kind: "gate",
        build: (): Step => ({
          kind: "gate",
          stepId: "term",
          gate: "HG-END",
          message: "the end",
        }),
      },
    ],
  },
];

describe("gate-passing integration", () => {
  it("loops at an uncleared gate, then flows past once cleared", async () => {
    // Step 1 — the spawn step.
    const first = await plan({}, gatedRegistry);
    const runId = first.runId;
    expect(first.step).toMatchObject({ stepId: "work" });
    const workResult = { ok: true };
    expect((await verify(runId, "work", workResult, gatedRegistry)).ok).toBe(true);
    await advance(runId, "work", workResult, gatedRegistry);

    // Step 2 — plan returns the gate; the run is awaiting_gate.
    const atGate = await plan({ runId }, gatedRegistry);
    expect(atGate.step).toMatchObject({ kind: "gate", stepId: "hg" });
    expect((await loadRunState(runId))!.status).toBe("awaiting_gate");

    // Gate not cleared — the check reports false, verify fails, conductor STOPs.
    expect((await verify(runId, "hg", { cleared: false }, gatedRegistry)).ok).toBe(false);

    // Re-plan — still the same gate (pure function of unchanged state).
    expect((await plan({ runId }, gatedRegistry)).step).toMatchObject({ stepId: "hg" });

    // Human clears the gate — the check now reports cleared.
    const cleared = { cleared: true };
    expect((await verify(runId, "hg", cleared, gatedRegistry)).ok).toBe(true);
    await advance(runId, "hg", cleared, gatedRegistry);

    // The run flows past the gate to completion.
    expect((await plan({ runId }, gatedRegistry)).step.kind).toBe("done");
  });

  it("a terminal gate (no check) is returned by plan every time", async () => {
    const { runId, step } = await plan({}, terminalGateRegistry);
    expect(step).toMatchObject({ kind: "gate", stepId: "term" });
    if (step.kind !== "gate") throw new Error("expected gate");
    expect(step.check).toBeUndefined();
    // No advance — the conductor STOPs. Re-plan returns the same terminal gate.
    expect((await plan({ runId }, terminalGateRegistry)).step).toMatchObject({ stepId: "term" });
  });
});
