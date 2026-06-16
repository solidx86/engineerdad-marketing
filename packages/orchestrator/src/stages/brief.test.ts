import { describe, it, expect } from "vitest";
import { briefStage } from "./brief.js";
import type { RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[]): RunState {
  return { runId: "run_b", stage: "brief", status: "active", params: {}, steps };
}

function doneStep(stepId: string, stage: string, result: unknown): RunStepState {
  return { stepId, stage, status: "done", result, problems: [], attempts: 1 };
}

describe("briefStage", () => {
  it("has B1-write (spawn) then B2-gate (gate)", () => {
    expect(briefStage.id).toBe("brief");
    expect(briefStage.steps.map((s) => s.id)).toEqual(["B1-write", "B2-gate"]);
    expect(briefStage.steps.map((s) => s.kind)).toEqual(["spawn", "gate"]);
  });

  it("B1 spawns brief-writer and carries the Memo's angles", () => {
    const memo = { recommendedAngles: ["cost-of-waiting"], personas: ["young_parents"] };
    const step = briefStage.steps[0]!.build(runWith([doneStep("S1-reason", "synthesize", memo)]));
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("brief-writer");
    expect(step.spawnPrompt).toContain("run_b");
    expect(step.spawnPrompt).toContain("cost-of-waiting");
  });

  it("B1 spawn prompt includes recommendedAngles verbatim", () => {
    const memo = { recommendedAngles: ["angle-a", "angle-b"] };
    const step = briefStage.steps[0]!.build(runWith([doneStep("S1-reason", "synthesize", memo)]));
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.spawnPrompt).toContain("angle-a");
    expect(step.spawnPrompt).toContain("angle-b");
  });

  it("B1 spawn prompt includes the CANONICAL ANGLE TAXONOMY hard-rule section", () => {
    const memo = { recommendedAngles: ["angle-a"] };
    const step = briefStage.steps[0]!.build(runWith([doneStep("S1-reason", "synthesize", memo)]));
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.spawnPrompt).toMatch(/canonical angle taxonomy/i);
    expect(step.spawnPrompt).toMatch(/verbatim/i);
    expect(step.spawnPrompt).toMatch(/skip.*don'?t pad/i);
  });

  it("B1.verify delegates to verifyBrief", () => {
    const b1 = briefStage.steps[0]!;
    expect(b1.verify).toBeDefined();
    expect(b1.verify!(runWith([]), { angles: ["a"] }).ok).toBe(true);
    expect(b1.verify!(runWith([]), {}).ok).toBe(false);
  });

  it("B2 is an HG1 gate with a Briefs-Approved check", () => {
    const step = briefStage.steps[1]!.build(runWith([]));
    if (step.kind !== "gate") throw new Error("expected gate");
    expect(step.gate).toBe("HG1");
    expect(step.check?.tool).toBe("mcp__store__query");
    const args = step.check?.args as { entity: string; filter: Record<string, unknown> };
    expect(args.entity).toBe("Briefs");
    expect(args.filter).toEqual({ runId: "run_b", approvalStatus: "Approved" });
  });

  it("B2.verify clears the gate only when an approved Brief exists", () => {
    const b2 = briefStage.steps[1]!;
    expect(b2.verify!(runWith([]), [{ id: "br1", title: "B1" }]).ok).toBe(true);
    expect(b2.verify!(runWith([]), []).ok).toBe(false);
  });
});
