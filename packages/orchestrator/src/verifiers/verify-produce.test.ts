import { describe, it, expect } from "vitest";
import {
  verifyProduce,
  verifyChartBindings,
  type ProduceVariant,
  type ProduceScript,
} from "./verify-produce.js";
import type { CreativeUnit } from "@engineerdad/shared/derive";

// Minimal SceneCard/CreativeUnit factories for the chart-binding tests.
function scene(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scene: 1, durationSec: 6, visual: "x", onScreenText: "headline",
    voiceover: "vo", shotNotes: "", chartRef: null, ...over,
  };
}
function creative(format: string, scenes: Record<string, unknown>[], scriptId = "s1"): CreativeUnit {
  return { scriptId, format, shotlistEn: scenes } as unknown as CreativeUnit;
}
const scriptWith = (bindings: ProduceScript["claimBindings"], id = "s1"): ProduceScript => ({
  id, claimBindings: bindings,
});
const DATA_BINDING = {
  kind: "data", chartRef: "inflation-vs-savings-real-value",
  figures: ["RM59,000"], takeaway: "Inflation taxed the savings account.",
};

describe("verifyChartBindings (ADR-030, P1)", () => {
  it("passes when every scene chartRef is a Script data binding", () => {
    const r = verifyChartBindings(
      [scriptWith([DATA_BINDING])],
      [creative("Reel", [
        scene({ chartRef: "inflation-vs-savings-real-value", explains: "Inflation taxed the savings account." }),
      ])],
    );
    expect(r.ok).toBe(true);
  });

  it("HARD-fails B-038 on a Reel: scene chartRef not in the Script's data bindings", () => {
    const r = verifyChartBindings(
      [scriptWith([DATA_BINDING])],
      [creative("Reel", [scene({ chartRef: "compounding-30y" })])],
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/compounding-30y.*not a kind:data binding.*B-038/);
  });

  it("HARD-fails B-038 on a Carousel too (all formats, not just Reels)", () => {
    const r = verifyChartBindings(
      [scriptWith([])], // script has NO data bindings → any chart is unbound
      [creative("Carousel", [scene({ chartRef: "inflation-vs-savings-real-value" })])],
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/Carousel.*B-038/);
  });

  it("HARD-fails B-036: a concept visual that contains a digit", () => {
    const r = verifyChartBindings(
      [scriptWith([])],
      [creative("Reel", [
        scene({ chartRef: null, visualBrief: "Two columns showing a 41% gap widening", onScreenText: "GAP" }),
      ])],
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/concept visual contains a digit.*B-036/);
  });

  it("passes a clean concept visual (no digits)", () => {
    const r = verifyChartBindings(
      [scriptWith([])],
      [creative("Reel", [
        scene({ chartRef: null, visualBrief: "Two columns: STAYS PUT vs KEEPS GROWING", onScreenText: "GAP WIDENS" }),
      ])],
    );
    expect(r.ok).toBe(true);
  });

  it("SOFT-flags an explains that doesn't echo the bound takeaway", () => {
    const r = verifyChartBindings(
      [scriptWith([DATA_BINDING])],
      [creative("Reel", [
        scene({ chartRef: "inflation-vs-savings-real-value", explains: "something unrelated entirely" }),
      ])],
    );
    expect(r.ok).toBe(true); // soft
    expect((r.data?.flags as string[]).join(" ")).toMatch(/does not echo any bound takeaway/);
  });
});

function variant(over: Partial<ProduceVariant> = {}): ProduceVariant {
  return {
    id: "v1",
    scriptId: "s1",
    format: "Reel",
    aspect: "9:16",
    channels: ["Meta-paid"],
    assetFiles: [],
    metaSpecComplete: true,
    organicSpecComplete: true,
    complianceCheck: true,
    estCostMyr: 5,
    organicCaptionEn: "",
    organicCaptionBm: "",
    ...over,
  };
}

const ASSET = [{ url: "https://store/x.png", sha256: "abc" }];

/** A complete 5-variant matrix for script s1 — sums to 25 MYR, 3 static variants. */
function completeSet(): ProduceVariant[] {
  return [
    variant({ id: "v-reel", format: "Reel", channels: ["Meta-paid"] }),
    variant({ id: "v-feed", format: "Feed", channels: ["Meta-paid"], assetFiles: ASSET }),
    variant({ id: "v-yt", format: "YT-Long", channels: ["YouTube"] }),
    variant({ id: "v-car1", format: "Carousel", channels: ["Meta-paid"], assetFiles: ASSET }),
    variant({
      id: "v-car2",
      format: "Carousel",
      channels: ["Meta-organic"],
      assetFiles: ASSET,
    }),
  ];
}

describe("verifyProduce", () => {
  it("passes a complete run", () => {
    const v = verifyProduce([{ id: "s1" }], completeSet(), 25, 3);
    expect(v).toEqual({ ok: true, problems: [] });
  });

  it("fails a short variant matrix", () => {
    const v = verifyProduce([{ id: "s1" }], completeSet().slice(0, 4), 20, 2);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("script s1: 4/5 variants");
  });

  it("fails when a static variant has no Asset Files", () => {
    const set = completeSet();
    set[1]!.assetFiles = [];
    const v = verifyProduce([{ id: "s1" }], set, 25, 3);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("variant v-feed: Asset Files empty");
  });

  it("fails an incomplete Meta spec", () => {
    const set = completeSet();
    set[0]!.metaSpecComplete = false;
    const v = verifyProduce([{ id: "s1" }], set, 25, 3);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("variant v-reel: Meta spec incomplete");
  });

  it("fails an incomplete organic spec", () => {
    const set = completeSet();
    set[4]!.organicSpecComplete = false;
    const v = verifyProduce([{ id: "s1" }], set, 25, 3);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("variant v-car2: organic spec incomplete");
  });

  it("fails when a compliance scan did not pass", () => {
    const set = completeSet();
    set[0]!.complianceCheck = false;
    const v = verifyProduce([{ id: "s1" }], set, 25, 3);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("variant v-reel: compliance scan did not pass");
  });

  it("fails when the reported total drifts from the per-variant sum", () => {
    const v = verifyProduce([{ id: "s1" }], completeSet(), 99, 3);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("totals.cost drifts from per-variant sum");
  });

  it("fails when static variants exist but no render worker ran", () => {
    const v = verifyProduce([{ id: "s1" }], completeSet(), 25, 0);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("3 static variants, 0 render workers ran");
  });

  it("fails a Script with no Notion rows — judges ground truth, not self-report", () => {
    // Two Scripts approved; Notion returned a complete matrix for s1 only.
    const v = verifyProduce([{ id: "s1" }, { id: "s2" }], completeSet(), 25, 3);
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("script s2: 0/5 variants");
  });

  describe("organic caption compliance footer", () => {
    it("fails an organic-channel variant whose caption lacks the compliance footer", () => {
      // Caption is non-empty but contains none of the required EN sentinel phrases.
      const variants = [
        variant({
          id: "v1",
          scriptId: "s1",
          format: "Carousel",
          aspect: "4:5",
          channels: ["Meta-organic"],
          assetFiles: [{ url: "u", sha256: "h" }],
          metaSpecComplete: true,
          organicSpecComplete: true,
          complianceCheck: true,
          estCostMyr: 5,
          organicCaptionEn:
            "Slide 1: Here is some educational content about unit trusts. No disclaimer here.",
          organicCaptionBm:
            "Slaid 1: Kandungan pendidikan tentang amanah saham. Tiada penafian di sini.",
        }),
        variant({ id: "v2", scriptId: "s1", format: "Reel", channels: ["Meta-paid"] }),
        variant({ id: "v3", scriptId: "s1", format: "Feed", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
        variant({ id: "v4", scriptId: "s1", format: "YT-Long", channels: ["YouTube"] }),
        variant({ id: "v5", scriptId: "s1", format: "Carousel", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
      ];
      const res = verifyProduce([{ id: "s1" }], variants, 25, 3);
      expect(res.ok).toBe(false);
      expect(res.problems.join(" ")).toMatch(/compliance|footer|caption|disclaimer/i);
    });

    it("passes an organic-channel variant whose caption carries the footer", () => {
      const variants = [
        variant({
          id: "v1",
          scriptId: "s1",
          format: "Carousel",
          aspect: "4:5",
          channels: ["Meta-organic"],
          assetFiles: [{ url: "u", sha256: "h" }],
          metaSpecComplete: true,
          organicSpecComplete: true,
          complianceCheck: true,
          estCostMyr: 5,
          organicCaptionEn:
            "Slide 1 content about unit trusts. Past performance is not guaranteed. FIMM. Public Mutual.",
          organicCaptionBm:
            "Kandungan slaid 1. Prestasi lampau tidak dijamin. FIMM. Public Mutual.",
        }),
        variant({ id: "v2", scriptId: "s1", format: "Reel", channels: ["Meta-paid"] }),
        variant({ id: "v3", scriptId: "s1", format: "Feed", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
        variant({ id: "v4", scriptId: "s1", format: "YT-Long", channels: ["YouTube"] }),
        variant({ id: "v5", scriptId: "s1", format: "Carousel", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
      ];
      const res = verifyProduce([{ id: "s1" }], variants, 25, 3);
      expect(res.ok).toBe(true);
    });

    it("ignores captions on non-organic variants", () => {
      // organicCaptionEn is empty (non-organic variant) — rule must not fire.
      const variants = [
        variant({
          id: "v1",
          scriptId: "s1",
          format: "Feed",
          aspect: "4:5",
          channels: ["Meta-paid"],
          assetFiles: [{ url: "u", sha256: "h" }],
          metaSpecComplete: true,
          organicSpecComplete: false,
          complianceCheck: true,
          estCostMyr: 5,
          organicCaptionEn: "",
          organicCaptionBm: "",
        }),
        variant({ id: "v2", scriptId: "s1", format: "Reel", channels: ["Meta-paid"] }),
        variant({ id: "v3", scriptId: "s1", format: "Carousel", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
        variant({ id: "v4", scriptId: "s1", format: "YT-Long", channels: ["YouTube"] }),
        variant({ id: "v5", scriptId: "s1", format: "Carousel", channels: ["Meta-organic"], assetFiles: [{ url: "u", sha256: "h" }],
          organicSpecComplete: true,
          organicCaptionEn: "",  // empty — rule skips it
          organicCaptionBm: "",
        }),
      ];
      const res = verifyProduce([{ id: "s1" }], variants, 25, 3);
      expect(res.ok).toBe(true);
    });

    it("channel-filter isolation: non-organic variant with populated non-compliant caption passes", () => {
      // channels is ["Meta-paid"] — the caption compliance rule must NOT fire
      // even though organicCaptionEn is non-empty and lacks any sentinel phrase.
      const variants = [
        variant({
          id: "v1",
          scriptId: "s1",
          format: "Feed",
          aspect: "4:5",
          channels: ["Meta-paid"],
          assetFiles: [{ url: "u", sha256: "h" }],
          metaSpecComplete: true,
          organicSpecComplete: false,
          complianceCheck: true,
          estCostMyr: 5,
          organicCaptionEn:
            "No disclaimer here at all — this would fail if the caption rule fired.",
          organicCaptionBm: "",
        }),
        variant({ id: "v2", scriptId: "s1", format: "Reel", channels: ["Meta-paid"] }),
        variant({ id: "v3", scriptId: "s1", format: "Carousel", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
        variant({ id: "v4", scriptId: "s1", format: "YT-Long", channels: ["YouTube"] }),
        variant({
          id: "v5",
          scriptId: "s1",
          format: "Carousel",
          channels: ["Meta-organic"],
          assetFiles: [{ url: "u", sha256: "h" }],
          organicSpecComplete: true,
          complianceCheck: true,
          organicCaptionEn:
            "Past performance is not guaranteed. FIMM. Public Mutual.",
          organicCaptionBm:
            "Prestasi lampau tidak dijamin. FIMM. Public Mutual.",
        }),
      ];
      const res = verifyProduce([{ id: "s1" }], variants, 25, 3);
      expect(res.ok).toBe(true);
    });

    it("fails when the EN caption is compliant but BM caption is non-compliant", () => {
      // EN caption carries the sentinel; BM caption is populated but missing BM sentinel.
      const variants = [
        variant({
          id: "v1",
          scriptId: "s1",
          format: "Carousel",
          aspect: "4:5",
          channels: ["Meta-organic"],
          assetFiles: [{ url: "u", sha256: "h" }],
          metaSpecComplete: true,
          organicSpecComplete: true,
          complianceCheck: true,
          estCostMyr: 5,
          organicCaptionEn:
            "Slide 1 content. Past performance is not guaranteed. FIMM. Public Mutual.",
          organicCaptionBm:
            "Slaid 1 kandungan tentang amanah saham. Tiada penafian BM di sini.",
        }),
        variant({ id: "v2", scriptId: "s1", format: "Reel", channels: ["Meta-paid"] }),
        variant({ id: "v3", scriptId: "s1", format: "Feed", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
        variant({ id: "v4", scriptId: "s1", format: "YT-Long", channels: ["YouTube"] }),
        variant({ id: "v5", scriptId: "s1", format: "Carousel", channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }] }),
      ];
      const res = verifyProduce([{ id: "s1" }], variants, 25, 3);
      expect(res.ok).toBe(false);
      expect(res.problems.join(" ")).toMatch(/BM/i);
    });
  });
});
