import { describe, it, expect } from "vitest";
import { design } from "./design.js";

describe("experiment.design", () => {
  it("expands a 2-factor factorial into all cells", () => {
    const out = design({
      hypothesis: "Aspiration hooks beat fear hooks among 35-45 parents",
      factors: [
        { name: "hook", levels: ["aspiration", "fear", "curiosity"] },
        { name: "format", levels: ["UGC", "talking_head"] },
      ],
      hold_constant: ["persona", "language"],
      primary_metric: "cpa",
      daily_budget_myr: 100,
      duration_days: 7,
    });
    expect(out.cells.length).toBe(6);
    expect(out.total_budget_myr).toBe(700);
    expect(out.min_creatives_needed).toBe(18);
    const buckets = out.cells.reduce<Record<string, number>>((acc, c) => {
      acc[c.bucket_label] = (acc[c.bucket_label] ?? 0) + 1;
      return acc;
    }, {});
    expect(buckets["70"]).toBeGreaterThan(0);
    expect(buckets["20"]).toBeGreaterThan(0);
    const total = out.cells.reduce((s, c) => s + c.allocation_pct, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("rejects empty factors", () => {
    expect(() =>
      design({
        hypothesis: "x",
        factors: [],
        hold_constant: [],
        primary_metric: "ctr",
        daily_budget_myr: 50,
        duration_days: 5,
      }),
    ).toThrow(/factors must be non-empty/);
  });

  it("rejects a factor with zero levels", () => {
    expect(() =>
      design({
        hypothesis: "x",
        factors: [{ name: "hook", levels: [] }],
        hold_constant: [],
        primary_metric: "ctr",
        daily_budget_myr: 50,
        duration_days: 5,
      }),
    ).toThrow(/no levels/);
  });
});
