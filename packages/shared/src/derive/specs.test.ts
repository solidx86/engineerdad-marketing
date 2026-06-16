import { describe, it, expect } from "vitest";
import {
  deriveMetaSpec,
  deriveYtSpec,
  deriveOrganicSpec,
  deriveSpecs,
  type CreativeUnit,
  type CreativeSource,
  type CreativePlan,
} from "./specs.js";
import { youtubeCategoryId } from "./channels.js";
import { variantId } from "./ids.js";

const DEFAULT_SOURCE: CreativeSource = {
  scriptBodyEn:
    "Most Malaysian parents never start a unit trust because they think they need a " +
    "lump sum. You can begin with RM100 a month and let compounding do the work.",
  scriptBodyMs:
    "Kebanyakan ibu bapa Malaysia tidak pernah memulakan amanah saham kerana fikir " +
    "mereka perlukan jumlah besar. Anda boleh mula dengan RM100 sebulan.",
  ctaEn: "Learn how to start today",
  ctaMs: "Ketahui cara untuk bermula",
  funnelStage: "MOFU",
  persona: "young_parents_25_35",
  topic: "Starting a unit trust",
  targetQuery: "how to start unit trust malaysia",
  primaryLang: "en",
};

function unit(
  over: Partial<CreativeUnit> = {},
  sourceOver: Partial<CreativeSource> = {},
): CreativeUnit {
  return {
    scriptId: "s1",
    format: "Feed",
    hook: { en: "The RM300 mistake every parent makes", ms: "Kesilapan RM300 ibu bapa", register: "curiosity" },
    shotlistEn: [],
    shotlistBm: [],
    thumbnailBrief: "tb",
    paletteEmphasis: "calm",
    estCostMyr: 175,
    source: { ...DEFAULT_SOURCE, ...sourceOver },
    ...over,
  };
}

describe("deriveMetaSpec", () => {
  it("derives a MOFU spec — SIGN_UP, capped, regulator phrase baked in", () => {
    const m = deriveMetaSpec(unit({}, { funnelStage: "MOFU" }));
    expect(m.ctaType).toBe("SIGN_UP");
    expect(m.primaryTextEn.length).toBeLessThanOrEqual(180);
    expect(m.primaryTextEn.toLowerCase()).toContain("not guaranteed");
    expect(m.headlineEn.length).toBeLessThanOrEqual(40);
    expect(m.descriptionEn.length).toBeLessThanOrEqual(30);
  });

  it("maps a BOFU consult CTA to WHATSAPP_MESSAGE", () => {
    const m = deriveMetaSpec(
      unit({}, { funnelStage: "BOFU", ctaEn: "Chat with our consultant on WhatsApp" }),
    );
    expect(m.ctaType).toBe("WHATSAPP_MESSAGE");
  });

  it("narrows targeting by persona age band", () => {
    const m = deriveMetaSpec(unit({}, { persona: "young_parents_25_35" }));
    const t = JSON.parse(m.targetingJson);
    expect(t.age_min).toBe(25);
    expect(t.age_max).toBe(35);
  });
});

describe("deriveYtSpec", () => {
  it("derives a YT-Long spec — title ≤100, tags joined ≤500, footer present", () => {
    const y = deriveYtSpec(unit({ format: "YT-Long" }));
    expect(y.title.length).toBeLessThanOrEqual(100);
    expect(y.tags.join(",").length).toBeLessThanOrEqual(500);
    expect(y.description).toContain("engineerdad.my");
  });

  it("auto-detects a how-to Topic as Howto & Style", () => {
    const y = deriveYtSpec(unit({}, { topic: "How to set up a DCA fund step-by-step" }));
    expect(y.category).toBe("Howto & Style");
    expect(youtubeCategoryId(y.category)).toBe("26");
  });
});

describe("deriveOrganicSpec", () => {
  it("derives an organic spec — 8–15 IG tags, 1–3 FB tags, caption capped", () => {
    const o = deriveOrganicSpec(unit({}, { primaryLang: "en" }));
    expect(o.language).toBe("EN");
    expect(o.hashtagsIg.length).toBeGreaterThanOrEqual(8);
    expect(o.hashtagsIg.length).toBeLessThanOrEqual(15);
    expect(o.hashtagsFb.length).toBeGreaterThanOrEqual(1);
    expect(o.hashtagsFb.length).toBeLessThanOrEqual(3);
    expect(o.captionEn.length).toBeLessThanOrEqual(2200);
  });

  it("maps a BM-primary unit's language to BM", () => {
    const o = deriveOrganicSpec(unit({}, { primaryLang: "ms" }));
    expect(o.language).toBe("BM");
  });
});

function plan(creatives: CreativeUnit[]): CreativePlan {
  return { runId: "run_1", creatives };
}

describe("deriveSpecs", () => {
  it("expands one Script's 4 creatives into the 5-format matrix", () => {
    const specs = deriveSpecs(
      plan([
        unit({ format: "Reel" }),
        unit({ format: "Feed" }),
        unit({ format: "YT-Long" }),
        unit({ format: "Carousel" }),
      ]),
      [],
    );
    expect(specs.map((v) => `${v.format} ${v.aspect}`)).toEqual([
      "Reel 9:16",
      "Feed 4:5",
      "YT-Long 16:9",
      "Carousel 4:5",
      "Carousel 1:1",
    ]);
  });

  it("the Carousel pair shares a shotlist and differs only in aspect", () => {
    const carousel = unit({
      format: "Carousel",
      shotlistEn: [
        { scene: 1, durationSec: 3, visual: "v", onScreenText: "t", voiceover: "vo", shotNotes: "s", chartRef: null },
      ],
    });
    const specs = deriveSpecs(plan([carousel]), []);
    expect(specs).toHaveLength(2);
    expect([specs[0]!.aspect, specs[1]!.aspect]).toEqual(["4:5", "1:1"]);
    expect(specs[0]!.shotlistEn).toEqual(specs[1]!.shotlistEn);
  });

  it("attaches yt for a YT-Long variant and leaves meta null", () => {
    const specs = deriveSpecs(plan([unit({ format: "YT-Long" })]), []);
    expect(specs[0]!.yt).not.toBeNull();
    expect(specs[0]!.meta).toBeNull();
    expect(specs[0]!.channels).toEqual(["YouTube"]);
  });

  it("leaves assetFiles empty for an unrendered static variant", () => {
    const specs = deriveSpecs(plan([unit({ format: "Feed" })]), []);
    expect(specs[0]!.assetFiles).toEqual([]);
  });

  it("joins an asset file by variantId from render results", () => {
    const id = variantId("s1", "Feed", "4:5");
    const specs = deriveSpecs(plan([unit({ format: "Feed" })]), [
      { variantId: id, url: "https://store/a.png", sha256: "abc" },
    ]);
    expect(specs[0]!.assetFiles).toEqual([{ url: "https://store/a.png", sha256: "abc" }]);
  });
});

describe("SceneCard two-type fields (ADR-029)", () => {
  it("a Reel data-visual SceneCard carries chartRef and no visualBrief", () => {
    const card: import("./specs.js").SceneCard = {
      scene: 2, durationSec: 6, visual: "full-frame chart", onScreenText: "By year 30",
      voiceover: "vo", shotNotes: "n", chartRef: "compounding-30y",
      sceneType: "visual", estimatedSeconds: 6,
      visualBrief: null, explains: "early start wins",
    };
    expect(card.sceneType).toBe("visual");
    expect(card.chartRef).toBe("compounding-30y");
    expect(card.visualBrief).toBeNull();
  });
  it("a Reel concept-visual SceneCard carries visualBrief and null chartRef", () => {
    const card: import("./specs.js").SceneCard = {
      scene: 3, durationSec: 7, visual: "split screen", onScreenText: "The cost of waiting",
      voiceover: "vo", shotNotes: "n", chartRef: null,
      sceneType: "visual", estimatedSeconds: 7,
      visualBrief: "Two-column split: Saver vs Investor.", explains: "waiting has a cost",
    };
    expect(card.sceneType).toBe("visual");
    expect(card.visualBrief).toBeTruthy();
    expect(card.chartRef).toBeNull();
  });
});
