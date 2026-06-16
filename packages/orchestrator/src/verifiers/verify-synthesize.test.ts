import { describe, it, expect } from "vitest";
import { verifySynthesize } from "./verify-synthesize.js";

const validMemo = {
  schemaVersion: 2 as const,
  runId: "run_x",
  memoId: "memo_x",
  recommendedAngles: ["fear", "aspiration"],
  personas: [],
  topCreatives: {},
  hypothesisIds: [],
  banditAllocation: {},
};

const validParams = {
  hypothesis: "fear beats hope",
  factors: [{ name: "angle", levels: ["fear", "aspiration"] }],
  holdConstant: [],
  primaryMetric: "cpa",
  dailyBudgetMyr: 200,
  durationDays: 7,
};

describe("verifySynthesize", () => {
  it("passes a Decision Memo carrying recommendedAngles", () => {
    expect(verifySynthesize({ ...validMemo })).toEqual({ ok: true, problems: [] });
  });

  it("fails a null / non-object result", () => {
    expect(verifySynthesize(null).ok).toBe(false);
    expect(verifySynthesize("memo").ok).toBe(false);
  });

  it("fails a Memo with no recommendedAngles", () => {
    expect(verifySynthesize({}).ok).toBe(false);
    expect(verifySynthesize({ recommendedAngles: [] }).ok).toBe(false);
  });

  // --- new: experimentParams shape ---

  it("passes a memo without experimentParams (legitimate-skip)", () => {
    expect(verifySynthesize({ ...validMemo })).toEqual({ ok: true, problems: [] });
  });

  it("passes a memo with a valid experimentParams block", () => {
    expect(verifySynthesize({ ...validMemo, experimentParams: validParams }))
      .toEqual({ ok: true, problems: [] });
  });

  it("fails on missing/empty hypothesis", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: { ...validParams, hypothesis: "" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/hypothesis/);
  });

  it("fails on factors with <2 levels", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: {
      ...validParams, factors: [{ name: "angle", levels: ["solo"] }] } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/levels/);
  });

  it("fails on unknown primaryMetric", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: {
      ...validParams, primaryMetric: "bogus" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/primaryMetric/);
  });

  it("fails on non-positive dailyBudgetMyr / durationDays", () => {
    const r1 = verifySynthesize({ ...validMemo, experimentParams: { ...validParams, dailyBudgetMyr: 0 } });
    expect(r1.ok).toBe(false);
    expect(r1.problems.join(" ")).toMatch(/dailyBudgetMyr/);

    const r2 = verifySynthesize({ ...validMemo, experimentParams: { ...validParams, durationDays: -1 } });
    expect(r2.ok).toBe(false);
    expect(r2.problems.join(" ")).toMatch(/durationDays/);
  });

  it("fails on holdConstant not an array", () => {
    const r = verifySynthesize({ ...validMemo, experimentParams: {
      ...validParams, holdConstant: "not-an-array" as unknown as string[] } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/holdConstant/);
  });
});
