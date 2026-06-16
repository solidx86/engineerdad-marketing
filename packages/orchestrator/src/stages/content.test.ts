import { describe, it, expect } from "vitest";
import { contentStage } from "./content.js";
import type { RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[] = []): RunState {
  return { runId: "run_c", stage: "content", status: "active", params: {}, steps };
}

function doneStep(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "content", status: "done", result, problems: [], attempts: 1 };
}

const REGISTERS = ["fear", "aspiration", "curiosity", "proof", "contrarian", "identity"] as const;
function hooks(n: number) {
  return REGISTERS.flatMap((register) =>
    Array.from({ length: n }, (_, i) => ({
      en: `en ${register} ${i}`,
      ms: `ms ${register} ${i}`,
      register,
    })),
  );
}
function validUnit(briefId: string) {
  return {
    briefId,
    hooks: hooks(5),
    scripts: [
      { id: `${briefId}-s1`, proofRefs: ["a.md"] },
      { id: `${briefId}-s2`, proofRefs: ["b.md"] },
      { id: `${briefId}-s3`, proofRefs: ["c.md"] },
      { id: `${briefId}-s4`, proofRefs: ["d.md"] },
      { id: `${briefId}-s5`, proofRefs: ["e.md"] },
    ],
  };
}

describe("contentStage", () => {
  it("has C0-briefs → C1-fanout → C2-articles → C3-gate", () => {
    expect(contentStage.id).toBe("content");
    expect(contentStage.steps.map((s) => s.id)).toEqual([
      "C0-briefs",
      "C1-fanout",
      "C2-articles",
      "C3-gate",
    ]);
    expect(contentStage.steps.map((s) => s.kind)).toEqual(["write", "fanout", "spawn", "gate"]);
  });

  it("C0-briefs queries approved Briefs for this run", () => {
    const step = contentStage.steps[0]!.build(runWith());
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]!.tool).toBe("mcp__store__query");
    const args = step.calls[0]!.args as { entity: string; filter: Record<string, unknown> };
    expect(args.entity).toBe("Briefs");
    expect(args.filter).toEqual({ runId: "run_c", approvalStatus: "Approved" });
  });

  it("C1-fanout dispatches one content-writer per approved Brief", () => {
    const briefsResult = [
      { id: "brief-1", title: "Brief 1" },
      { id: "brief-2", title: "Brief 2" },
    ];
    const run = runWith([doneStep("C0-briefs", [briefsResult])]);
    const step = contentStage.steps[1]!.build(run);
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.worker).toBe("content-writer");
    expect(step.units).toHaveLength(2);
    expect(step.units[0]!.spawnPrompt).toContain("brief-1");
    expect(step.units[1]!.spawnPrompt).toContain("brief-2");
    expect(step.units[0]!.spawnPrompt).toContain("Single-Brief worker mode");
    expect(step.units[0]!.spawnPrompt).toContain("mcp__store__get");
  });

  it("C1-fanout throws if C0-briefs returned no Briefs", () => {
    const run = runWith([doneStep("C0-briefs", [[]])]);
    expect(() => contentStage.steps[1]!.build(run)).toThrow(/no approved Briefs/);
  });

  it("C1-fanout.verify accepts an array of valid per-Brief units", async () => {
    const spec = contentStage.steps[1]!;
    const goodArray = [validUnit("b1"), validUnit("b2")];
    // verify is async (ADR-030: loads the live chart index for figures-trace).
    expect((await spec.verify!(runWith(), goodArray)).ok).toBe(true);
    expect((await spec.verify!(runWith(), [])).ok).toBe(false);
  });

  it("C2-articles spawns content-writer in article mode", () => {
    const briefsResult = [{ id: "brief-1", title: "Brief 1" }];
    const run = runWith([
      doneStep("C0-briefs", [briefsResult]),
      doneStep("C1-fanout", [validUnit("brief-1")]),
    ]);
    const step = contentStage.steps[2]!.build(run);
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("content-writer");
    expect(step.spawnPrompt).toContain("Article mode");
    expect(step.spawnPrompt).toContain("run_c");
    expect(step.spawnPrompt).toContain("brief-1");
  });

  it("C3-gate is HG2 with a Scripts-approved check", () => {
    const step = contentStage.steps[3]!.build(runWith());
    if (step.kind !== "gate") throw new Error("expected gate");
    expect(step.gate).toBe("HG2");
    expect(step.check?.tool).toBe("mcp__store__query");
    const args = step.check?.args as { entity: string; filter: Record<string, unknown> };
    expect(args.entity).toBe("Scripts");
    expect(args.filter).toEqual({ runId: "run_c", approvalStatus: "Approved" });
  });

  it("C3.verify clears the gate only when an approved Script exists", () => {
    const gate = contentStage.steps[3]!;
    expect(gate.verify!(runWith(), [{ id: "sc1", title: "S1" }]).ok).toBe(true);
    expect(gate.verify!(runWith(), []).ok).toBe(false);
  });
});
