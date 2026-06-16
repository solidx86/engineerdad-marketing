import { describe, it, expect } from "vitest";
import { mapCellsToVariants, applyAllocation, type MappedCell } from "./allocation.js";

describe("mapCellsToVariants", () => {
  it("attaches variants whose factor tags match the cell's factor levels", () => {
    const cells = [
      { cellId: "c1", factorLevels: { angle: "fear", format: "Reel" } },
      { cellId: "c2", factorLevels: { angle: "hope", format: "Reel" } },
    ];
    const variants = [
      { pageId: "v1", factorTags: { angle: "fear", format: "Reel" }, budgetBucket: "70" as const },
      { pageId: "v2", factorTags: { angle: "hope", format: "Reel" }, budgetBucket: "20" as const },
      { pageId: "v3", factorTags: { angle: "fear", format: "Reel" }, budgetBucket: "70" as const },
    ];
    const mapped = mapCellsToVariants(cells, variants);
    expect(mapped[0]!.variantPageIds).toEqual(["v1", "v3"]);
    expect(mapped[1]!.variantPageIds).toEqual(["v2"]);
  });

  it("derives the cell bucket from the majority of matched variants", () => {
    const cells = [{ cellId: "c1", factorLevels: { angle: "fear" } }];
    const variants = [
      { pageId: "v1", factorTags: { angle: "fear" }, budgetBucket: "70" as const },
      { pageId: "v2", factorTags: { angle: "fear" }, budgetBucket: "70" as const },
      { pageId: "v3", factorTags: { angle: "fear" }, budgetBucket: "20" as const },
    ];
    expect(mapCellsToVariants(cells, variants)[0]!.bucket).toBe("70");
  });

  it("defaults the bucket to 20 on a tie or with no variants", () => {
    const tie = mapCellsToVariants(
      [{ cellId: "c1", factorLevels: { a: "x" } }],
      [
        { pageId: "v1", factorTags: { a: "x" }, budgetBucket: "70" as const },
        { pageId: "v2", factorTags: { a: "x" }, budgetBucket: "10" as const },
      ],
    );
    expect(tie[0]!.bucket).toBe("20");
    const empty = mapCellsToVariants([{ cellId: "c1", factorLevels: { a: "z" } }], []);
    expect(empty[0]!.bucket).toBe("20");
    expect(empty[0]!.variantPageIds).toEqual([]);
  });
});

describe("applyAllocation", () => {
  const cell = (cellId: string, bucket: "70" | "20" | "10"): MappedCell => ({
    cellId,
    factorLevels: {},
    variantPageIds: [],
    bucket,
  });

  it("splits each bucket's share across its cells", () => {
    const out = applyAllocation([
      cell("a", "70"),
      cell("b", "70"),
      cell("c", "20"),
      cell("d", "10"),
    ]);
    const pct = Object.fromEntries(out.map((c) => [c.cellId, c.allocationPct]));
    expect(pct.a).toBe(35); // 70 / 2
    expect(pct.b).toBe(35);
    expect(pct.c).toBe(20); // 20 / 1
    expect(pct.d).toBe(10); // 10 / 1
  });

  it("redistributes an empty bucket's share proportionally", () => {
    // No "10" cells: its 10 goes to 70 and 20, proportional to their base shares.
    const out = applyAllocation([cell("a", "70"), cell("b", "20")]);
    const sum = out.reduce((s, c) => s + c.allocationPct, 0);
    expect(sum).toBeCloseTo(100, 1);
    expect(out.find((c) => c.cellId === "a")!.allocationPct).toBeGreaterThan(70);
    expect(out.find((c) => c.cellId === "b")!.allocationPct).toBeGreaterThan(20);
  });

  it("gives a single cell the full 100", () => {
    expect(applyAllocation([cell("solo", "70")])[0]!.allocationPct).toBe(100);
  });

  it("allocations sum to 100", () => {
    const out = applyAllocation([
      cell("a", "70"),
      cell("b", "70"),
      cell("c", "70"),
      cell("d", "20"),
      cell("e", "10"),
    ]);
    expect(out.reduce((s, c) => s + c.allocationPct, 0)).toBeCloseTo(100, 1);
  });
});
