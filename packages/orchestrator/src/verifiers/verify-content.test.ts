import { describe, it, expect } from "vitest";
import {
  verifyContent,
  verifyContentUnit,
  foldContentUnits,
  verifyClaimBindings,
  type ChartIndex,
} from "./verify-content.js";

// The real inflation-vs-savings chart's depicted numbers (labels ∪ series ∪
// derived caption ratio). B-038's mis-paired chart.
const INFLATION_NUMBERS = [
  0, 5, 10, 15, 18, 100000, 86000, 75000, 65000, 59000, 110000, 122000, 135000, 143000, 0.41,
];
const CHARTS: ChartIndex = new Map([
  ["inflation-vs-savings-real-value", INFLATION_NUMBERS],
  ["compounding-30y", [0, 22000, 55000, 104000, 177000, 285000, 447000]],
]);

/** A C1-fanout unit carrying one script with the given claimBindings. */
function unitWithBindings(briefId: string, bindings: unknown[]): unknown {
  return { briefId, hooks: [], scripts: [{ id: "s1", proofRefs: ["p.md"], claimBindings: bindings }] };
}

describe("verifyClaimBindings (ADR-030, C1)", () => {
  it("passes a data binding whose figures all trace to its chart", () => {
    const r = verifyClaimBindings(
      [unitWithBindings("b1", [
        { claim: "RM143,000 is really worth RM59,000 — a 41% loss", kind: "data",
          chartRef: "inflation-vs-savings-real-value",
          figures: ["RM143,000", "RM59,000", "41%"], takeaway: "x", gapNote: null },
      ])],
      CHARTS,
    );
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("HARD-fails the B-038 case: claim figure absent from the bound chart", () => {
    const r = verifyClaimBindings(
      [unitWithBindings("b1", [
        // RM1.2M is nowhere in the inflation chart — the classic mis-pairing.
        { claim: "You will have RM1.2M by retirement", kind: "data",
          chartRef: "inflation-vs-savings-real-value",
          figures: ["RM1.2M"], takeaway: "x", gapNote: null },
      ])],
      CHARTS,
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/RM1\.2M.*does not trace.*B-038/);
  });

  it("HARD-fails a data binding pointing at a non-existent chart", () => {
    const r = verifyClaimBindings(
      [unitWithBindings("b1", [
        { claim: "RM59,000", kind: "data", chartRef: "no-such-chart",
          figures: ["RM59,000"], takeaway: "x", gapNote: null },
      ])],
      CHARTS,
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/not a real chart/);
  });

  it("passes a gap binding (held) without touching the chart index", () => {
    const r = verifyClaimBindings(
      [unitWithBindings("b1", [
        { claim: "EPF RM240k @ RM2k/mo lasts ~13 years", kind: "gap", chartRef: null,
          figures: ["RM240,000", "RM2,000"], takeaway: "x",
          gapNote: "no EPF-drawdown dataset" },
      ])],
      CHARTS,
    );
    expect(r.ok).toBe(true);
  });

  it("passes a qualitative binding (concept, no chart)", () => {
    const r = verifyClaimBindings(
      [unitWithBindings("b1", [
        { claim: "Starting early beats starting big", kind: "qualitative",
          chartRef: null, figures: [], takeaway: "consistency", gapNote: null },
      ])],
      CHARTS,
    );
    expect(r.ok).toBe(true);
  });

  it("SOFT-flags a financial token in the claim that is missing from figures[]", () => {
    const r = verifyClaimBindings(
      [unitWithBindings("b1", [
        // claim mentions RM143,000 + RM59,000 but figures only list one → flag, not fail.
        { claim: "RM143,000 is really worth RM59,000", kind: "data",
          chartRef: "inflation-vs-savings-real-value",
          figures: ["RM143,000"], takeaway: "x", gapNote: null },
      ])],
      CHARTS,
    );
    expect(r.ok).toBe(true); // soft only
    expect((r.data?.flags as string[]).join(" ")).toMatch(/RM59,000.*absent from the binding/);
  });

  it("ignores scripts with no bindings (legacy / brand scripts)", () => {
    const r = verifyClaimBindings([unitWithBindings("b1", [])], CHARTS);
    expect(r.ok).toBe(true);
  });
});

const REGISTERS = ["fear", "aspiration", "curiosity", "proof", "contrarian", "identity"] as const;

/** A hooks[] array carrying `perRegister` hooks in each of the 6 registers. */
function hooks(perRegister: number): { en: string; ms: string; register: string }[] {
  const out: { en: string; ms: string; register: string }[] = [];
  for (const register of REGISTERS) {
    for (let i = 0; i < perRegister; i++) {
      out.push({ en: `en ${register} ${i}`, ms: `ms ${register} ${i}`, register });
    }
  }
  return out;
}

/** A hook bank satisfying the §8 rule — 6 registers, 5 each, 30 total. */
function validBank(briefId = "b1") {
  return { briefId, hooks: hooks(5) };
}

function validResult() {
  return { scripts: ["s1"], hookBanks: [validBank()] };
}

describe("verifyContent", () => {
  it("passes a result with scripts and a complete ≥30 hook bank", () => {
    expect(verifyContent(validResult())).toEqual({ ok: true, problems: [] });
  });

  it("fails a null / non-object result", () => {
    expect(verifyContent(null).ok).toBe(false);
    expect(verifyContent("scripts").ok).toBe(false);
  });

  it("fails a result with no scripts", () => {
    expect(verifyContent({ hookBanks: [validBank()] }).ok).toBe(false);
    expect(verifyContent({ scripts: [], hookBanks: [validBank()] }).ok).toBe(false);
  });

  it("fails a result with scripts but no hook banks", () => {
    expect(verifyContent({ scripts: ["s1"] }).ok).toBe(false);
    expect(verifyContent({ scripts: ["s1"], hookBanks: [] }).ok).toBe(false);
  });

  it("fails a hook bank below the 30-hook minimum", () => {
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "b1", hooks: hooks(3) }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("30");
  });

  it("fails a hook bank missing an emotional register", () => {
    const noIdentity = hooks(6).filter((h) => h.register !== "identity");
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "b1", hooks: noIdentity }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("identity");
  });

  it("fails a hook bank with a register below 3 hooks", () => {
    const thin = hooks(7).filter((h) => h.register !== "fear");
    thin.push(
      { en: "en fear 0", ms: "ms fear 0", register: "fear" },
      { en: "en fear 1", ms: "ms fear 1", register: "fear" },
    );
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "b1", hooks: thin }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("fear");
  });

  it("counts hooks from hooks[], ignoring any self-reported summary fields", () => {
    // The bank LIES via summary fields but actually carries a full, valid 30.
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [
        { briefId: "b1", totalHooks: 18, registerCounts: { fear: 3 }, hooks: hooks(5) },
      ],
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("names the offending Brief in hook-bank problems", () => {
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "brief-xyz", hooks: hooks(3) }],
    });
    expect(result.problems.join(" ")).toContain("brief-xyz");
  });
});

/** A valid per-Brief unit — 30 hooks across 6 registers, 5 scripts all with proofRefs. */
function validUnit(briefId = "b1") {
  return {
    briefId,
    hooks: hooks(5),
    scripts: [
      { id: "s1", proofRefs: ["a.md"] },
      { id: "s2", proofRefs: ["b.md"] },
      { id: "s3", proofRefs: ["c.md"] },
      { id: "s4", proofRefs: ["d.md"] },
      { id: "s5", proofRefs: ["e.md"] },
    ],
  };
}

describe("verifyContentUnit", () => {
  it("passes a unit with 30 hooks across 6 registers and ≥80% proof", () => {
    expect(verifyContentUnit(validUnit())).toEqual({ ok: true, problems: [] });
  });

  it("fails a unit missing a register", () => {
    const noFear = hooks(6).filter((h) => h.register !== "fear");
    expect(
      verifyContentUnit({ briefId: "b1", hooks: noFear, scripts: validUnit().scripts }).ok,
    ).toBe(false);
  });

  it("fails a unit with <30 hooks", () => {
    expect(
      verifyContentUnit({ briefId: "b1", hooks: hooks(3), scripts: validUnit().scripts }).ok,
    ).toBe(false);
  });

  it("fails a unit with proofRatio below 0.80", () => {
    const scripts = [
      { id: "s1", proofRefs: ["a.md"] },
      { id: "s2", proofRefs: [] },
      { id: "s3", proofRefs: [] },
      { id: "s4", proofRefs: [] },
      { id: "s5", proofRefs: [] },
    ];
    const result = verifyContentUnit({ briefId: "b1", hooks: hooks(5), scripts });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("proof");
  });

  it("passes a unit with exactly 80% proof", () => {
    const scripts = [
      { id: "s1", proofRefs: ["a.md"] },
      { id: "s2", proofRefs: ["b.md"] },
      { id: "s3", proofRefs: ["c.md"] },
      { id: "s4", proofRefs: ["d.md"] },
      { id: "s5", proofRefs: [] },
    ];
    expect(verifyContentUnit({ briefId: "b1", hooks: hooks(5), scripts })).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("names the offending Brief in unit problems", () => {
    const result = verifyContentUnit({ briefId: "brief-xyz", hooks: hooks(3), scripts: [] });
    expect(result.problems.join(" ")).toContain("brief-xyz");
  });

  it("fails a non-object / null unit", () => {
    expect(verifyContentUnit(null).ok).toBe(false);
    expect(verifyContentUnit("nope").ok).toBe(false);
  });
});

describe("verifyContent — array (C1-fanout) path", () => {
  it("passes an array of valid per-Brief units", () => {
    expect(verifyContent([validUnit("b1"), validUnit("b2"), validUnit("b3")])).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("fails an empty array", () => {
    const r = verifyContent([]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("no per-Brief units");
  });

  it("surfaces the first failing unit even if the union proof ratio is ≥0.80", () => {
    const good = validUnit("b1");
    const bad = {
      briefId: "b2",
      hooks: hooks(5),
      scripts: [
        { id: "s1", proofRefs: ["a.md"] },
        { id: "s2", proofRefs: [] },
        { id: "s3", proofRefs: [] },
        { id: "s4", proofRefs: [] },
        { id: "s5", proofRefs: [] },
      ],
    };
    const r = verifyContent([good, bad]);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("b2");
  });
});

describe("foldContentUnits", () => {
  it("flattens scripts and emits one hookBanks entry per unit", () => {
    const folded = foldContentUnits([validUnit("b1"), validUnit("b2")]);
    expect(folded.scripts).toHaveLength(10);
    expect(folded.hookBanks).toEqual([
      { briefId: "b1", hooks: validUnit("b1").hooks },
      { briefId: "b2", hooks: validUnit("b2").hooks },
    ]);
  });

  it("recomputes proofRatio across the union", () => {
    const folded = foldContentUnits([validUnit("b1"), validUnit("b2")]);
    expect(folded.proofRatio).toBeCloseTo(1.0);
  });

  it("ignores non-object units", () => {
    const folded = foldContentUnits([null, validUnit("b1")]);
    expect(folded.hookBanks).toHaveLength(1);
  });
});
