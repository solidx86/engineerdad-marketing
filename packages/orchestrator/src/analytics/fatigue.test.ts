import { describe, it, expect } from "vitest";
import { detectFatigue, type DecayCurve } from "./fatigue.js";

function curve(adId: string, cpas: number[]): DecayCurve {
  return {
    adId,
    points: cpas.map((cpa, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      cpa,
    })),
  };
}

describe("detectFatigue", () => {
  it("flags a curve whose recent CPA is >25% over baseline", () => {
    // first 7 baseline = 10; last 3 recent = 14 → +40%
    const rows = detectFatigue([curve("ad1", [10, 10, 10, 10, 10, 10, 10, 14, 14, 14])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.adId).toBe("ad1");
    expect(rows[0]!.baselineCpaMyr).toBe(10);
    expect(rows[0]!.recentCpaMyr).toBe(14);
    expect(rows[0]!.deltaPct).toBeCloseTo(40);
  });

  it("does not flag a flat curve", () => {
    const rows = detectFatigue([curve("ad1", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10])]);
    expect(rows).toEqual([]);
  });

  it("evaluates a curve shorter than 7 points off the first-half median", () => {
    // 4 points: baseline = median of first 2 = 8; recent = mean of last 3 = 12 → +50%
    const rows = detectFatigue([curve("ad1", [8, 8, 12, 16])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.baselineCpaMyr).toBe(8);
    expect(rows[0]!.recentCpaMyr).toBeCloseTo(12);
    expect(rows[0]!.deltaPct).toBeCloseTo(50);
  });

  it("returns an empty result for an empty curve list", () => {
    expect(detectFatigue([])).toEqual([]);
  });
});
