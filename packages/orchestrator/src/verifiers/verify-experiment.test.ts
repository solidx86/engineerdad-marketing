import { describe, it, expect } from "vitest";
import { verifyExperiment } from "./verify-experiment.js";
import type { AllocatedCell } from "../experiment/allocation.js";

function cell(over: Partial<AllocatedCell> = {}): AllocatedCell {
  return {
    cellId: "c1",
    factorLevels: {},
    variantPageIds: ["v1"],
    bucket: "70",
    allocationPct: 50,
    ...over,
  };
}

function triCell(id: string, n: number, pct = 33.3): AllocatedCell {
  return {
    cellId: id,
    factorLevels: { angle: id },
    variantPageIds: Array.from({ length: n }, (_, i) => `v_${id}_${i}`),
    bucket: "70",
    allocationPct: pct,
  };
}

describe("verifyExperiment", () => {
  it("passes a complete allocated design", () => {
    const v = verifyExperiment(
      [cell({ cellId: "a", allocationPct: 50 }), cell({ cellId: "b", allocationPct: 50 })],
      true,
    );
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it("fails when the Experiment row was not created", () => {
    expect(verifyExperiment([cell({ allocationPct: 100 })], false).ok).toBe(false);
  });

  it("fails when allocations do not sum to 100", () => {
    expect(verifyExperiment([cell({ allocationPct: 60 })], true).ok).toBe(false);
  });

  it("fails a design with no cells", () => {
    expect(verifyExperiment([], true).ok).toBe(false);
  });
});

describe("verifyExperiment tri-state", () => {
  it("3-of-3 cells occupied → full + ok", () => {
    const r = verifyExperiment(
      [triCell("A", 1), triCell("B", 1), triCell("C", 1, 33.4)],
      true,
    );
    expect(r.ok).toBe(true);
    expect(r.data?.experimentStatus).toBe("full");
  });

  it("2-of-3 cells occupied → degraded + ok", () => {
    const r = verifyExperiment(
      [triCell("A", 1), triCell("B", 1), triCell("C", 0, 33.4)],
      true,
    );
    expect(r.ok).toBe(true);
    expect(r.data?.experimentStatus).toBe("degraded");
  });

  it("1-of-3 cells occupied → single-cell + ok", () => {
    const r = verifyExperiment(
      [triCell("A", 1), triCell("B", 0), triCell("C", 0, 33.4)],
      true,
    );
    expect(r.ok).toBe(true);
    expect(r.data?.experimentStatus).toBe("single-cell");
  });

  it("0-of-3 cells occupied → broken + ok:false", () => {
    const r = verifyExperiment(
      [triCell("A", 0), triCell("B", 0), triCell("C", 0, 33.4)],
      true,
    );
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/all cells empty/i);
    expect(r.data?.experimentStatus).toBe("broken");
  });

  it("still fails when experiment row not created", () => {
    const r = verifyExperiment([triCell("A", 1, 100)], false);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes("not created"))).toBe(true);
    expect(r.data).toBeUndefined();
  });
});
