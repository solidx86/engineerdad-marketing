import { describe, it, expect } from "vitest";
import { rebindGapToData, hasOpenGap, type ClaimBinding } from "./claim-bindings.js";
import { ClaimBindingSchema } from "./zod.js";
import { tracesTo } from "./numeric/normalize.js";

const gap: ClaimBinding = {
  claim: "An EPF balance of RM240k drawn at RM2k/mo lasts ~13 years",
  kind: "gap",
  chartRef: null,
  figures: ["RM240,000", "RM2,000", "13 years"],
  takeaway: "The pot runs dry long before life does.",
  gapNote: "No EPF-drawdown dataset yet — needs /chart-gap authoring.",
};
const qualitative: ClaimBinding = {
  claim: "Starting early beats starting big",
  kind: "qualitative",
  chartRef: null,
  figures: [],
  takeaway: "Consistency beats intensity.",
  gapNote: null,
};

describe("rebindGapToData", () => {
  it("promotes the matching gap binding to a valid data binding", () => {
    const out = rebindGapToData([qualitative, gap], {
      claim: gap.claim,
      chartRef: "epf-drawdown-13y",
      figures: ["RM240,000", "RM2,000", "13 years"],
    });
    const promoted = out.find((b) => b.claim === gap.claim)!;
    expect(promoted.kind).toBe("data");
    expect(promoted.chartRef).toBe("epf-drawdown-13y");
    expect(promoted.gapNote).toBeNull();
    // The result is a schema-valid data binding (no longer held).
    expect(() => ClaimBindingSchema.parse(promoted)).not.toThrow();
    expect(hasOpenGap(out)).toBe(false);
  });

  it("keeps the gap takeaway unless a new one is supplied", () => {
    const out = rebindGapToData([gap], { claim: gap.claim, chartRef: "c", figures: ["RM240,000"] });
    expect(out[0]!.takeaway).toBe(gap.takeaway);
    const out2 = rebindGapToData([gap], {
      claim: gap.claim, chartRef: "c", figures: ["RM240,000"], takeaway: "new",
    });
    expect(out2[0]!.takeaway).toBe("new");
  });

  it("leaves sibling bindings untouched and does not mutate the input", () => {
    const input = [qualitative, gap];
    const out = rebindGapToData(input, { claim: gap.claim, chartRef: "c", figures: ["RM240,000"] });
    expect(out[0]).toEqual(qualitative);
    expect(input[1]!.kind).toBe("gap"); // original unchanged
  });

  it("throws when no gap binding matches the claim (no silent no-op)", () => {
    expect(() => rebindGapToData([qualitative], { claim: "nope", chartRef: "c", figures: [] })).toThrow(
      /no gap binding/,
    );
  });

  it("the rebound figures trace to the newly-authored chart (C1 would pass)", () => {
    const out = rebindGapToData([gap], {
      claim: gap.claim, chartRef: "epf-drawdown-13y", figures: ["RM240,000", "RM2,000"],
    });
    const chartNumbers = [240000, 2000, 13]; // the authored chart's depicted values
    for (const fig of out[0]!.figures) {
      expect(tracesTo(fig, chartNumbers)).toBe(true);
    }
  });
});
