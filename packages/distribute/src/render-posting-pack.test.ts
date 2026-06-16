import { describe, it, expect } from "vitest";
import { renderPostingPack } from "./render-posting-pack.js";
import type { DistVariant } from "@engineerdad/orchestrator";
import type { AllocatedCell } from "@engineerdad/orchestrator";

const cell: AllocatedCell = { cellId: "cell-A", allocationPct: 70, variantPageIds: ["v1"] } as AllocatedCell;

function variant(over: Partial<DistVariant> = {}): DistVariant {
  return {
    rowId: "row-1", variantId: "v1", format: "Feed", aspect: "4:5",
    channels: ["Meta-paid"], assetFiles: [{ url: "https://r2/a/1.png" }],
    adId: null, ytVideoId: null,
    metaSpec: {
      primaryTextEn: "PT en", primaryTextMs: "PT ms", headlineEn: "H en", headlineMs: "H ms",
      descriptionEn: "D en", descriptionMs: "D ms", ctaType: "LEARN_MORE", targetingJson: "",
    },
    ytSpec: null, cellId: "cell-A", fbPostId: null,
    organicScheduledFor: null, organicCaption: null, organicLang: null, ...over,
  } as DistVariant;
}

describe("renderPostingPack", () => {
  it("renders campaign, one adset per cell, and EN/BM ad copy", () => {
    const pack = renderPostingPack("run_1", [variant()], [cell], 10);
    expect(pack.campaign.objective).toBe("OUTCOME_LEADS");
    expect(pack.adsets).toHaveLength(1);
    expect(pack.adsets[0].dailyBudgetCents).toBe(700);
    expect(pack.adsets[0].targeting.locales).toEqual([6, 41]);
    expect(pack.ads).toHaveLength(1);
    expect(pack.ads[0].en.primaryText).toBe("PT en");
    expect(pack.ads[0].bm.headline).toBe("H ms");
    expect(pack.ads[0].asset.urls).toEqual(["https://r2/a/1.png"]);
    expect(pack.ads[0].backfill.done).toBe(false);
  });

  it("marks backfill done when adId is set", () => {
    const pack = renderPostingPack("run_1", [variant({ adId: { en: "111", ms: "222" } })], [cell], 10);
    expect(pack.ads[0].backfill).toEqual({ adIdEn: "111", adIdMs: "222", done: true });
  });

  it("skips variants without a metaSpec or cellId", () => {
    const pack = renderPostingPack("run_1", [variant({ metaSpec: null })], [cell], 10);
    expect(pack.ads).toHaveLength(0);
    expect(pack.adsets).toHaveLength(0);
  });

  it("excludes non-Meta-paid variants", () => {
    const pack = renderPostingPack("run_1", [variant({ channels: ["YouTube"] })], [cell], 10);
    expect(pack.ads).toHaveLength(0);
  });
});
