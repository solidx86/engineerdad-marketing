import { describe, it, expect } from "vitest";
import { fixtureStage } from "./fixture.js";
import type { RunState } from "../types.js";

const fakeRun: RunState = {
  runId: "run_x",
  stage: "fixture",
  status: "active",
  params: {},
  steps: [],
};

describe("fixtureStage", () => {
  it("has 2 unique spawn steps", () => {
    expect(fixtureStage.id).toBe("fixture");
    expect(fixtureStage.steps).toHaveLength(2);
    expect(fixtureStage.steps.every((s) => s.kind === "spawn")).toBe(true);
    const ids = fixtureStage.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("build yields a valid spawn Step targeting general-purpose", () => {
    const spec = fixtureStage.steps[0]!;
    const step = spec.build(fakeRun);
    expect(step.kind).toBe("spawn");
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("general-purpose");
    expect(step.stepId).toBe(spec.id);
    expect(step.spawnPrompt).toContain(spec.id);
  });

  it("verify passes a matching echo object", () => {
    const spec = fixtureStage.steps[0]!;
    expect(spec.verify!(fakeRun, { ok: true, step: spec.id }).ok).toBe(true);
  });

  it("verify accepts a stringified echo", () => {
    const spec = fixtureStage.steps[0]!;
    expect(spec.verify!(fakeRun, JSON.stringify({ ok: true, step: spec.id })).ok).toBe(true);
  });

  it("verify fails a mismatched step id", () => {
    const spec = fixtureStage.steps[0]!;
    const v = spec.verify!(fakeRun, { ok: true, step: "wrong" });
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  it("verify fails a missing ok flag", () => {
    const spec = fixtureStage.steps[0]!;
    expect(spec.verify!(fakeRun, { step: spec.id }).ok).toBe(false);
  });
});
