import { describe, expect, it } from "vitest";
import {
  OrganicStatus,
  OrganicLanguage,
  MediaProductionOutputSchema,
  DistributionRowSchema,
  ReelShotlistSchema,
  ReelShotlistSceneSchema,
  ClaimBindingSchema,
} from "./zod.js";

describe("OrganicStatus enum", () => {
  it("accepts valid statuses", () => {
    for (const s of ["Drafted", "Approved", "Rejected", "Published", "Failed"]) {
      expect(OrganicStatus.parse(s)).toBe(s);
    }
  });
  it("rejects unknown status", () => {
    expect(() => OrganicStatus.parse("Pending")).toThrow();
  });
});

describe("OrganicLanguage enum", () => {
  it("accepts EN and BM", () => {
    expect(OrganicLanguage.parse("EN")).toBe("EN");
    expect(OrganicLanguage.parse("BM")).toBe("BM");
  });
  it("rejects others", () => {
    expect(() => OrganicLanguage.parse("ZH")).toThrow();
  });
});

describe("MediaProductionOutput organic spec refines", () => {
  const baseVariant = {
    variantId: "var_test",
    channels: ["Meta-organic" as const],
    organicCaptionEN: "Short caption.",
    organicCaptionBM: "Pendek.",
    organicHashtagsIG: ["#unittrust", "#prsmalaysia", "#kewangan", "#parenting", "#engineerdad", "#malaysia", "#financialplanning", "#publicmutual"],
    organicHashtagsFB: ["#unittrust", "#prsmalaysia"],
  };

  it("accepts caption ≤2200 chars", () => {
    const out = { variants: [baseVariant], totals: { totalEstimatedCostMYR: 0 } };
    expect(() => MediaProductionOutputSchema.parse(out)).not.toThrow();
  });

  it("rejects caption >2200 chars", () => {
    const bad = { ...baseVariant, organicCaptionEN: "x".repeat(2201) };
    const out = { variants: [bad], totals: { totalEstimatedCostMYR: 0 } };
    expect(() => MediaProductionOutputSchema.parse(out)).toThrow(/2200/);
  });

  it("rejects IG hashtags <8 or >15", () => {
    const tooFew = { ...baseVariant, organicHashtagsIG: ["#a", "#b"] };
    const tooMany = { ...baseVariant, organicHashtagsIG: Array(16).fill("#x") };
    for (const v of [tooFew, tooMany]) {
      expect(() =>
        MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
      ).toThrow();
    }
  });

  it("rejects FB hashtags >3", () => {
    const tooMany = { ...baseVariant, organicHashtagsFB: ["#a", "#b", "#c", "#d"] };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [tooMany], totals: { totalEstimatedCostMYR: 0 } })
    ).toThrow();
  });

  // Issue #3 — cross-field refine: Meta-organic variants must have the required organic fields

  it("rejects Meta-organic variant missing organicCaptionEN when language is EN", () => {
    const v = { ...baseVariant, organicLanguage: "EN" as const, organicCaptionEN: undefined };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
    ).toThrow();
  });

  it("rejects Meta-organic variant missing organicCaptionBM when language is BM", () => {
    const v = { ...baseVariant, organicLanguage: "BM" as const, organicCaptionBM: undefined };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
    ).toThrow();
  });

  it("rejects Meta-organic variant missing organicHashtagsIG", () => {
    const v = { ...baseVariant, organicHashtagsIG: undefined };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
    ).toThrow();
  });

  it("rejects Meta-organic variant missing organicHashtagsFB", () => {
    const v = { ...baseVariant, organicHashtagsFB: undefined };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
    ).toThrow();
  });

  // Issue #4 — # prefix enforcement

  it("rejects IG hashtags missing # prefix", () => {
    const v = {
      ...baseVariant,
      organicHashtagsIG: ["unittrust", "prsmalaysia", "kewangan", "parenting", "engineerdad", "malaysia", "financialplanning", "publicmutual"],
    };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
    ).toThrow();
  });

  // Issue #5 — FB hashtag empty array (below min 1)

  it("rejects FB hashtags below 1 (empty array)", () => {
    const v = { ...baseVariant, organicHashtagsFB: [] };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
    ).toThrow();
  });

  // Issue #6 — else-branch: non-Meta-organic variants don't require organic fields

  it("accepts variant with non-organic channels and no organic fields", () => {
    const v = { variantId: "var_paid", channels: ["Meta-paid" as const] };
    expect(() =>
      MediaProductionOutputSchema.parse({ variants: [v], totals: { totalEstimatedCostMYR: 0 } })
    ).not.toThrow();
  });
});

describe("DistributionRowSchema", () => {
  const validRow = {
    id: "11111111-1111-1111-1111-111111111111",
    runId: "run_test",
    title: "route CreativeVariants/abc → Meta-paid",
    targetEntity: "CreativeVariants" as const,
    targetId: "22222222-2222-2222-2222-222222222222",
    channel: "Meta-paid" as const,
    status: "routed" as const,
    tool: "mcp__meta-ads__create_ad",
    attemptedAt: "2026-05-27T12:00:00.000Z",
    completedAt: "2026-05-27T12:00:01.500Z",
    outputJson: { adId: "ad_123" },
    errorMessage: null,
    skipReason: null,
    attempt: 1,
    dryRun: false,
    authorStep: "D2b-route" as const,
    approvalStatus: "Logged",
    complianceCheck: true,
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:00:01.500Z",
  };

  it("parses a valid row", () => {
    expect(() => DistributionRowSchema.parse(validRow)).not.toThrow();
  });

  it("throws on missing required field", () => {
    const { channel: _drop, ...incomplete } = validRow;
    expect(() => DistributionRowSchema.parse(incomplete)).toThrow();
  });

  it("throws on invalid status enum", () => {
    expect(() => DistributionRowSchema.parse({ ...validRow, status: "fake" })).toThrow();
  });

  it("throws on invalid channel enum", () => {
    expect(() => DistributionRowSchema.parse({ ...validRow, channel: "TikTok" })).toThrow();
  });

  it("throws on invalid targetEntity enum", () => {
    expect(() => DistributionRowSchema.parse({ ...validRow, targetEntity: "Briefs" })).toThrow();
  });

  it("throws on invalid authorStep enum", () => {
    expect(() => DistributionRowSchema.parse({ ...validRow, authorStep: "D9-nope" })).toThrow();
  });

  it("allows nullable optional fields to be null", () => {
    const r = {
      ...validRow,
      tool: null,
      completedAt: null,
      errorMessage: null,
      skipReason: null,
    };
    expect(() => DistributionRowSchema.parse(r)).not.toThrow();
  });
});

// ── ReelShotlistSchema (per ADR-029, two-type face|visual model) ──
describe("ReelShotlistSchema", () => {
  type SceneOverrides = {
    scene?: string;
    voiceover?: string;
    onScreenText?: string;
    chartRef?: string | null;
    visualBrief?: string | null;
    explains?: string | null;
    shotNotes?: string;
    sceneType?: "face" | "visual";
    estimatedSeconds?: number;
  };
  const validScene = (o: SceneOverrides = {}) => ({
    scene: "1",
    voiceover: "Start early and let time do the work.",
    onScreenText: "Start at 30",
    chartRef: null,
    visualBrief: null,
    explains: null,
    shotNotes: "tight on face",
    sceneType: "face" as const,
    estimatedSeconds: 4,
    ...o,
  });
  const dataVisual = () =>
    validScene({ scene: "2", sceneType: "visual", chartRef: "compounding-30y",
      visualBrief: null, explains: "early start wins", estimatedSeconds: 8 });
  const conceptVisual = () =>
    validScene({ scene: "2", sceneType: "visual", chartRef: null,
      visualBrief: "Two-column split: Saver vs Investor; widening gap arrow.",
      explains: "waiting has a cost", estimatedSeconds: 7 });
  const validShotlist = {
    format: "Reel" as const,
    hook: { en: "Hook EN", ms: "Hook BM" },
    shotlistEn: [validScene(), dataVisual(), validScene({ scene: "3" })],
    targetSeconds: 25,
    faceFirstHook: true,
  };

  it("accepts a valid 3-scene Reel (face → data-visual → face)", () => {
    expect(() => ReelShotlistSchema.parse(validShotlist)).not.toThrow();
  });

  it("accepts a concept visual (visualBrief set, chartRef null)", () => {
    expect(() => ReelShotlistSceneSchema.parse(conceptVisual())).not.toThrow();
  });

  it("accepts a data visual (chartRef set, visualBrief null)", () => {
    expect(() => ReelShotlistSceneSchema.parse(dataVisual())).not.toThrow();
  });

  it("rejects a visual with NEITHER chartRef nor visualBrief (XOR)", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "visual", chartRef: null, visualBrief: null }),
      ),
    ).toThrow();
  });

  it("rejects a visual with BOTH chartRef and visualBrief (XOR)", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "visual", chartRef: "compounding-30y",
          visualBrief: "a split screen" }),
      ),
    ).toThrow();
  });

  it("rejects a face scene carrying a chartRef", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(validScene({ sceneType: "face", chartRef: "compounding-30y" })),
    ).toThrow();
  });

  it("rejects the retired 'chart' sceneType", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "chart" as unknown as "visual", chartRef: "compounding-30y" }),
      ),
    ).toThrow();
  });

  it("rejects the retired 'face-over-chart' sceneType", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "face-over-chart" as unknown as "visual" }),
      ),
    ).toThrow();
  });

  it("accepts face scene with null chartRef and null visualBrief", () => {
    expect(() => ReelShotlistSceneSchema.parse(validScene({ sceneType: "face" }))).not.toThrow();
  });

  it("rejects face voiceover exceeding 30 words", () => {
    const longVo = Array(31).fill("w").join(" ");
    expect(() =>
      ReelShotlistSceneSchema.parse(validScene({ sceneType: "face", voiceover: longVo })),
    ).toThrow();
  });

  it("accepts visual voiceover up to 45 words", () => {
    const vo = Array(45).fill("w").join(" ");
    expect(() =>
      ReelShotlistSceneSchema.parse(dataVisual()).voiceover !== undefined &&
        ReelShotlistSceneSchema.parse({ ...dataVisual(), voiceover: vo }),
    ).not.toThrow();
  });

  it("rejects targetSeconds below 15 / above 60 / non-integer", () => {
    expect(() => ReelShotlistSchema.parse({ ...validShotlist, targetSeconds: 10 })).toThrow();
    expect(() => ReelShotlistSchema.parse({ ...validShotlist, targetSeconds: 75 })).toThrow();
    expect(() => ReelShotlistSchema.parse({ ...validShotlist, targetSeconds: 22.5 })).toThrow();
  });
});

describe("ClaimBindingSchema (ADR-030)", () => {
  const dataBinding = {
    claim: "RM100k in a 2% savings account loses ~41% of purchasing power over 18 years",
    kind: "data" as const,
    chartRef: "inflation-vs-savings-real-value",
    figures: ["RM100,000", "RM59,000", "41%"],
    takeaway: "The savings account didn't keep your money safe — inflation taxed it.",
    gapNote: null,
  };

  it("accepts a well-formed data binding", () => {
    expect(() => ClaimBindingSchema.parse(dataBinding)).not.toThrow();
  });

  it("rejects kind:data with no chartRef", () => {
    expect(() => ClaimBindingSchema.parse({ ...dataBinding, chartRef: null })).toThrow();
  });

  it("rejects kind:data with no figures", () => {
    expect(() => ClaimBindingSchema.parse({ ...dataBinding, figures: [] })).toThrow();
  });

  it("accepts a qualitative binding with no chart", () => {
    expect(() =>
      ClaimBindingSchema.parse({
        claim: "Starting early matters more than starting big",
        kind: "qualitative",
        chartRef: null,
        figures: [],
        takeaway: "Consistency beats intensity.",
        gapNote: null,
      }),
    ).not.toThrow();
  });

  it("rejects kind:qualitative that still carries a chartRef", () => {
    expect(() =>
      ClaimBindingSchema.parse({
        claim: "Starting early matters",
        kind: "qualitative",
        chartRef: "compounding-30y",
        figures: [],
        takeaway: "x",
        gapNote: null,
      }),
    ).toThrow();
  });

  it("accepts a gap binding (held): chartRef null + gapNote set", () => {
    expect(() =>
      ClaimBindingSchema.parse({
        claim: "An EPF balance of RM240k drawn down at RM2k/mo lasts ~13 years",
        kind: "gap",
        chartRef: null,
        figures: ["RM240,000", "RM2,000", "13 years"],
        takeaway: "The pot runs dry long before life does.",
        gapNote: "No EPF-drawdown dataset yet — needs /chart-gap authoring.",
      }),
    ).not.toThrow();
  });

  it("rejects kind:gap with a chartRef", () => {
    expect(() =>
      ClaimBindingSchema.parse({
        claim: "x",
        kind: "gap",
        chartRef: "some-chart",
        figures: [],
        takeaway: "x",
        gapNote: "missing",
      }),
    ).toThrow();
  });

  it("rejects kind:gap with an empty gapNote", () => {
    expect(() =>
      ClaimBindingSchema.parse({
        claim: "x",
        kind: "gap",
        chartRef: null,
        figures: [],
        takeaway: "x",
        gapNote: "   ",
      }),
    ).toThrow();
  });
});
