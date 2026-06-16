import { describe, it, expect } from "vitest";
import { PlanInputSchema, VerifyInputSchema, AdvanceInputSchema } from "./schemas.js";

describe("PlanInputSchema", () => {
  it("accepts an empty object (fresh run)", () => {
    expect(PlanInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts runId + args", () => {
    expect(PlanInputSchema.safeParse({ runId: "run_1", args: "hello" }).success).toBe(true);
  });

  it("rejects an empty runId string", () => {
    expect(PlanInputSchema.safeParse({ runId: "" }).success).toBe(false);
  });
});

describe("VerifyInputSchema", () => {
  it("accepts runId + stepId + an arbitrary result", () => {
    const r = VerifyInputSchema.safeParse({
      runId: "run_1",
      stepId: "fixture-1",
      result: { ok: true },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing runId", () => {
    expect(VerifyInputSchema.safeParse({ stepId: "fixture-1" }).success).toBe(false);
  });

  it("rejects a missing stepId", () => {
    expect(VerifyInputSchema.safeParse({ runId: "run_1" }).success).toBe(false);
  });
});

describe("AdvanceInputSchema", () => {
  it("accepts runId + stepId + result", () => {
    expect(
      AdvanceInputSchema.safeParse({ runId: "run_1", stepId: "fixture-1", result: 42 }).success,
    ).toBe(true);
  });

  it("rejects a missing stepId", () => {
    expect(AdvanceInputSchema.safeParse({ runId: "run_1", result: 1 }).success).toBe(false);
  });
});
