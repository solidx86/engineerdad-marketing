import { describe, it, expect } from "vitest";
import { youtubeCategoryId } from "@engineerdad/shared/derive";
import {
  planDistribution,
  planMetaPaid,
  planMetaPaidSetup,
  planMetaPaidRows,
  targetingForCell,
  adsetStep,
  dailyBudgetCentsFor,
  CAMPAIGN_OBJECTIVE,
  LOCALE_ID,
  __creativeStepForTests as creativeStep,
  type DistVariant,
  type DistArticle,
} from "./plan-distribution.js";
import type { AllocatedCell } from "../experiment/allocation.js";

function variant(over: Partial<DistVariant> = {}): DistVariant {
  return {
    rowId: "row1",
    variantId: "v1abc",
    format: "Reel",
    aspect: "9:16",
    channels: ["Meta-paid"],
    assetFiles: [{ url: "https://store/a.mp4" }],
    adId: null,
    ytVideoId: null,
    metaSpec: {
      primaryTextEn: "pt en",
      primaryTextMs: "pt ms",
      headlineEn: "h en",
      headlineMs: "h ms",
      descriptionEn: "d en",
      descriptionMs: "d ms",
      ctaType: "LEARN_MORE",
      targetingJson: "{}",
    },
    ytSpec: null,
    cellId: "c1",
    fbPostId: null,
    organicScheduledFor: null,
    organicCaption: null,
    organicLang: null,
    ...over,
  };
}

const cell: AllocatedCell = {
  cellId: "c1",
  factorLevels: {},
  variantPageIds: ["v1"],
  bucket: "70",
  allocationPct: 100,
};

describe("planDistribution — Meta-paid", () => {
  it("plans the campaign/adset/upload/creative/ad chain for a complete variant", () => {
    const plan = planDistribution("run_1", [variant()], [], [cell], { dailyBudgetMyr: 100 });
    expect(plan.setup.map((s) => s.tool)).toEqual([
      "mcp__meta-ads__create_campaign",
      "mcp__meta-ads__create_adset",
    ]);
    expect(plan.setup[0]!.captures).toBe("campaign");
    expect(plan.setup[1]!.needs).toContain("campaign");
    expect(plan.rowPlans).toHaveLength(1);
    const steps = plan.rowPlans[0]!.steps;
    expect(steps.map((s) => s.tool)).toEqual([
      "mcp__meta-ads__upload_video",
      "mcp__meta-ads__create_ad_creative",
      "mcp__meta-ads__create_ad_creative",
      "mcp__meta-ads__create_ad",
      "mcp__meta-ads__create_ad",
    ]);
    expect(steps[3]!.needs).toContain("adset:c1");
    expect(plan.backfills).toHaveLength(1);
  });

  it("uploads an image for a static format", () => {
    const v = variant({ format: "Feed", aspect: "1:1", assetFiles: [{ url: "x.png" }] });
    const plan = planDistribution("run_1", [v], [], [cell], { dailyBudgetMyr: 100 });
    expect(plan.rowPlans[0]!.steps[0]!.tool).toBe("mcp__meta-ads__upload_image");
  });

  it("skips a variant whose Ad ID is already populated", () => {
    const v = variant({ adId: { en: "ad_en", ms: "ad_ms" } });
    const plan = planDistribution("run_1", [v], [], [cell], { dailyBudgetMyr: 100 });
    expect(plan.rowPlans).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toMatch(/already/i);
  });

  it("skips a variant with no Meta spec and notes it", () => {
    const plan = planDistribution("run_1", [variant({ metaSpec: null })], [], [cell], {});
    expect(plan.rowPlans).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toMatch(/Meta spec/i);
    expect(plan.notes.length).toBeGreaterThan(0);
  });

  it("skips a variant not assigned to an experiment cell", () => {
    const plan = planDistribution("run_1", [variant({ cellId: null })], [], [cell], {});
    expect(plan.rowPlans).toHaveLength(0);
  });

  it("flags dryRun on the plan", () => {
    const plan = planDistribution("run_1", [variant()], [], [cell], { dryRun: true });
    expect(plan.dryRun).toBe(true);
  });

  it("creates one adset per distinct cell", () => {
    const v1 = variant({ rowId: "r1", variantId: "va", cellId: "c1" });
    const v2 = variant({ rowId: "r2", variantId: "vb", cellId: "c2" });
    const c2: AllocatedCell = { ...cell, cellId: "c2" };
    const plan = planDistribution("run_1", [v1, v2], [], [cell, c2], { dailyBudgetMyr: 100 });
    const adsets = plan.setup.filter((s) => s.tool === "mcp__meta-ads__create_adset");
    expect(adsets).toHaveLength(2);
  });
});

describe("adsetStep budget + targeting", () => {
  const cellA: AllocatedCell = {
    cellId: "A",
    factorLevels: { angle: "A" },
    variantPageIds: ["v1"],
    bucket: "70",
    allocationPct: 70,
  };

  it("computes daily_budget_cents from dailyBudgetMyr × allocationPct (0-100 convention → MYR-cents)", () => {
    const step = adsetStep("r1", cellA, 10);
    // 10 MYR × 70 (pct, 0-100) = 700 cents
    expect(step.args.daily_budget_cents).toBe(700);
  });

  it("floors daily_budget_cents to 1 when budget is 0", () => {
    const step = adsetStep("r1", cellA, 0);
    expect(step.args.daily_budget_cents).toBe(1);
  });

  it("includes a targeting block with MY geo + 25-55 age + both EN/MS locales", () => {
    const step = adsetStep("r1", cellA, 10);
    const targeting = step.args.targeting as {
      geo_locations: { countries: string[] };
      age_min: number;
      age_max: number;
      locales: number[];
    };
    expect(targeting).toBeDefined();
    expect(targeting.geo_locations.countries).toEqual(["MY"]);
    expect(targeting.age_min).toBe(25);
    expect(targeting.age_max).toBe(55);
    expect(targeting.locales).toEqual([LOCALE_ID.en, LOCALE_ID.ms]);
  });
});

describe("targetingForCell", () => {
  it("returns minimum broad block with MY geo + 25-55 age + both locales", () => {
    const c: AllocatedCell = {
      cellId: "A",
      factorLevels: { angle: "A" },
      variantPageIds: [],
      bucket: "70",
      allocationPct: 70,
    };
    const t = targetingForCell(c);
    expect(t.geo_locations).toEqual({ countries: ["MY"] });
    expect(t.age_min).toBe(25);
    expect(t.age_max).toBe(55);
    expect(t.locales).toEqual([LOCALE_ID.en, LOCALE_ID.ms]);
  });

  it("LOCALE_ID has both keys non-zero", () => {
    expect(LOCALE_ID.en).toBeGreaterThan(0);
    expect(LOCALE_ID.ms).toBeGreaterThan(0);
  });
});

const ytSpec = { title: "T", description: "D", tags: ["a"], category: "Education" };

describe("planDistribution — YouTube", () => {
  it("plans an upload with the mapped category id", () => {
    const v = variant({ channels: ["YouTube"], format: "YT-Long", metaSpec: null, ytSpec });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans).toHaveLength(1);
    const step = plan.rowPlans[0]!.steps[0]!;
    expect(step.tool).toBe("mcp__youtube__upload_video");
    expect(step.args.category_id).toBe(youtubeCategoryId("Education"));
    expect(plan.backfills).toHaveLength(1);
  });

  it("skips a YouTube variant whose YT Video ID is populated", () => {
    const v = variant({ channels: ["YouTube"], metaSpec: null, ytSpec, ytVideoId: "yt_abc" });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toMatch(/already/i);
  });

  it("skips a YouTube variant with no YT spec", () => {
    const v = variant({ channels: ["YouTube"], metaSpec: null, ytSpec: null });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans).toHaveLength(0);
    expect(plan.notes.length).toBeGreaterThan(0);
  });
});

describe("planDistribution — organic FB", () => {
  const organicBase = {
    channels: ["Meta-organic"],
    organicScheduledFor: "2026-05-28T11:00:00.000Z",
    organicCaption: "Selamat datang",
    organicLang: "ms",
    metaSpec: null,
  };

  it("plans a publish_image_post on FB for a Meta-organic Feed variant", () => {
    const v = variant({
      ...organicBase,
      format: "Feed",
      aspect: "1:1",
      assetFiles: [{ url: "https://store/a.png" }],
    });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans).toHaveLength(1);
    const step = plan.rowPlans[0]!.steps[0]!;
    expect(step.tool).toBe("mcp__meta-organic__publish_image_post");
    expect(step.args.platform).toBe("fb");
    expect(plan.backfills.some((b) => b.tool === "mcp__store__update")).toBe(true);
  });

  it("plans a publish_video_post for a Meta-organic Reel", () => {
    const v = variant({ ...organicBase, format: "Reel", aspect: "9:16" });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans[0]!.steps[0]!.tool).toBe("mcp__meta-organic__publish_video_post");
  });

  it("excludes a Carousel 4:5 from organic FB (E-025)", () => {
    const v = variant({ ...organicBase, format: "Carousel", aspect: "4:5" });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toMatch(/E-025/);
  });

  it("skips a variant whose FB Post ID is already populated (idempotent)", () => {
    const v = variant({ ...organicBase, format: "Feed", aspect: "1:1", fbPostId: "fb_existing" });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toMatch(/already/i);
  });

  it("skips a Meta-organic variant with no Organic Scheduled For", () => {
    const v = variant({ ...organicBase, format: "Feed", aspect: "1:1", organicScheduledFor: null });
    const plan = planDistribution("run_1", [v], [], []);
    expect(plan.rowPlans).toHaveLength(0);
  });
});

function article(over: Partial<DistArticle> = {}): DistArticle {
  return {
    rowId: "art1",
    slug: "my-slug",
    titleEn: "Title EN",
    titleMs: "Title MS",
    description: "desc",
    topicTag: "retirement",
    readingTime: "5 min",
    keywords: ["epf", "prs"],
    ogImageUrl: "https://example.com/og.jpg",
    datePublished: "2026-05-27",
    heroImageUrl: null,
    heroImageAlt: null,
    bodyEn: "body en",
    bodyMs: "body ms",
    faqEn: "faq en",
    faqMs: "faq ms",
    deliveredAt: null,
    ...over,
  };
}

describe("planDistribution — articles", () => {
  it("drafts both languages for a complete article", () => {
    const plan = planDistribution("run_1", [], [article()], []);
    expect(plan.rowPlans).toHaveLength(1);
    expect(plan.rowPlans[0]!.steps.map((s) => s.tool)).toEqual([
      "mcp__engineerdad_site__draft_article",
      "mcp__engineerdad_site__draft_article",
    ]);
    expect(plan.backfills).toHaveLength(1);
  });

  it("skips a language whose body or FAQ is missing", () => {
    const plan = planDistribution("run_1", [], [article({ faqMs: null })], []);
    expect(plan.rowPlans[0]!.steps).toHaveLength(1);
    expect(plan.notes.some((n) => /MS skipped/.test(n))).toBe(true);
  });

  it("ignores an already-delivered article", () => {
    const plan = planDistribution("run_1", [], [article({ deliveredAt: "2026-05-20" })], []);
    expect(plan.rowPlans).toHaveLength(0);
  });
});

describe("planMetaPaidSetup", () => {
  it("returns an empty PlanPart when there are 0 routable Meta variants", () => {
    const part = planMetaPaidSetup("run_1", [], [cell], 100);
    expect(part.setup).toEqual([]);
    expect(part.rowPlans).toEqual([]);
    expect(part.backfills).toEqual([]);
  });

  it("emits campaign + adset for 1 routable variant on a known cell", () => {
    const part = planMetaPaidSetup("run_1", [variant()], [cell], 100);
    expect(part.setup.map((s) => s.tool)).toEqual([
      "mcp__meta-ads__create_campaign",
      "mcp__meta-ads__create_adset",
    ]);
    expect(part.setup[0]!.captures).toBe("campaign");
    expect(part.setup[1]!.captures).toBe("adset:c1");
    expect(part.setup[1]!.needs).toContain("campaign");
    expect(part.rowPlans).toEqual([]);
    expect(part.backfills).toEqual([]);
  });

  it("deduplicates adsets for two variants sharing one cell", () => {
    const v1 = variant({ rowId: "r1", variantId: "va", cellId: "c1" });
    const v2 = variant({ rowId: "r2", variantId: "vb", cellId: "c1" });
    const part = planMetaPaidSetup("run_1", [v1, v2], [cell], 100);
    const adsets = part.setup.filter((s) => s.tool === "mcp__meta-ads__create_adset");
    expect(adsets).toHaveLength(1);
    expect(adsets[0]!.captures).toBe("adset:c1");
  });

  it("excludes the adset for a cell not in the experiment design and notes it", () => {
    const v = variant({ cellId: "cX" });
    const part = planMetaPaidSetup("run_1", [v], [cell], 100);
    // Only the campaign should be emitted — no adset for the unknown cell.
    expect(part.setup.map((s) => s.tool)).toEqual(["mcp__meta-ads__create_campaign"]);
    expect(part.notes.some((n) => /cX not in/i.test(n))).toBe(true);
  });
});

describe("planMetaPaidRows", () => {
  it("returns an empty PlanPart when there are 0 routable Meta variants", () => {
    const part = planMetaPaidRows([], [cell]);
    expect(part.rowPlans).toEqual([]);
    expect(part.backfills).toEqual([]);
    expect(part.setup).toEqual([]);
  });

  it("emits 5 steps + 1 backfill for 1 routable Meta variant", () => {
    const part = planMetaPaidRows([variant()], [cell]);
    expect(part.setup).toEqual([]);
    expect(part.rowPlans).toHaveLength(1);
    expect(part.rowPlans[0]!.steps.map((s) => s.tool)).toEqual([
      "mcp__meta-ads__upload_video",
      "mcp__meta-ads__create_ad_creative",
      "mcp__meta-ads__create_ad_creative",
      "mcp__meta-ads__create_ad",
      "mcp__meta-ads__create_ad",
    ]);
    expect(part.backfills).toHaveLength(1);
  });

  it("skips when adId is already populated", () => {
    const v = variant({ adId: { en: "ad_en", ms: "ad_ms" } });
    const part = planMetaPaidRows([v], [cell]);
    expect(part.rowPlans).toEqual([]);
    expect(part.skipped[0]!.reason).toMatch(/Ad ID already populated/);
  });

  it("skips when metaSpec is missing", () => {
    const v = variant({ metaSpec: null });
    const part = planMetaPaidRows([v], [cell]);
    expect(part.rowPlans).toEqual([]);
    expect(part.skipped[0]!.reason).toMatch(/Meta spec missing — re-run \/produce/);
  });

  it("skips when cellId is null", () => {
    const v = variant({ cellId: null });
    const part = planMetaPaidRows([v], [cell]);
    expect(part.rowPlans).toEqual([]);
    expect(part.skipped[0]!.reason).toMatch(/not assigned to an experiment cell/);
  });

  it("skips when cellId is not in the cells array", () => {
    const v = variant({ cellId: "cX" });
    const part = planMetaPaidRows([v], [cell]);
    expect(part.rowPlans).toEqual([]);
    expect(part.skipped[0]!.reason).toMatch(/cell cX not in the experiment design/);
  });
});

describe("planMetaPaid integration", () => {
  it("produces campaign + per-cell adsets with budgets + targeting + both locales", () => {
    const cellA: AllocatedCell = {
      cellId: "cA",
      factorLevels: { angle: "A" },
      variantPageIds: ["vA"],
      bucket: "70",
      allocationPct: 70,
    };
    const cellB: AllocatedCell = {
      cellId: "cB",
      factorLevels: { angle: "B" },
      variantPageIds: ["vB"],
      bucket: "20",
      allocationPct: 30,
    };
    const variants = [
      variant({ rowId: "rA", variantId: "vA", cellId: "cA" }),
      variant({ rowId: "rB", variantId: "vB", cellId: "cB" }),
    ];

    const part = planMetaPaid("r_test", variants, [cellA, cellB], 10);

    // 1 campaign
    const campaignStep = part.setup.find((s) => s.tool === "mcp__meta-ads__create_campaign");
    expect(campaignStep).toBeDefined();

    // 2 adsets, both with budget > 0 + targeting block + both locales
    const adsetSteps = part.setup.filter((s) => s.tool === "mcp__meta-ads__create_adset");
    expect(adsetSteps).toHaveLength(2);
    for (const a of adsetSteps) {
      const args = a.args as {
        daily_budget_cents: number;
        targeting?: { geo_locations: { countries: string[] }; locales: number[] };
      };
      expect(args.daily_budget_cents).toBeGreaterThan(0);
      expect(args.targeting).toBeDefined();
      expect(args.targeting?.geo_locations.countries).toEqual(["MY"]);
      expect(args.targeting?.locales).toEqual([LOCALE_ID.en, LOCALE_ID.ms]);
    }

    // Each cell's adset has the right budget (10 MYR × 70 = 700 cents for A, × 30 = 300 for B).
    const adsetA = adsetSteps.find((s) => (s.args as { name: string }).name.includes("cA"));
    const adsetB = adsetSteps.find((s) => (s.args as { name: string }).name.includes("cB"));
    expect((adsetA?.args as { daily_budget_cents: number }).daily_budget_cents).toBe(700);
    expect((adsetB?.args as { daily_budget_cents: number }).daily_budget_cents).toBe(300);

    // Row plans + backfills wired through too (one per variant).
    expect(part.rowPlans).toHaveLength(2);
    expect(part.backfills).toHaveLength(2);
  });
});

describe("Fix B — adset bid strategy + advantage audience", () => {
  const cell = { cellId: "cell_01", allocationPct: 70, variantPageIds: ["v1"] } as never;

  it("adsetStep sets bid_strategy LOWEST_COST_WITHOUT_CAP", () => {
    const step = adsetStep("run_x", cell, 100);
    expect((step.args as Record<string, unknown>).bid_strategy).toBe("LOWEST_COST_WITHOUT_CAP");
  });

  it("adsetStep keeps a positive daily_budget_cents (budget unchanged by Fix B)", () => {
    const step = adsetStep("run_x", cell, 100);
    expect((step.args as Record<string, unknown>).daily_budget_cents).toBe(7000);
  });

  it("targetingForCell adds targeting_automation.advantage_audience = 0 alongside geo/age/locales", () => {
    const t = targetingForCell(cell) as Record<string, unknown>;
    expect(t.targeting_automation).toEqual({ advantage_audience: 0 });
    expect(t.geo_locations).toEqual({ countries: ["MY"] });
    expect(t.age_min).toBe(25);
    expect(t.age_max).toBe(55);
    expect(Array.isArray(t.locales)).toBe(true);
  });
});

describe("Fix A — creativeStep contract", () => {
  const v = { variantId: "var1", rowId: "row1" } as never;
  const spec = {
    ctaType: "LEARN_MORE",
    primaryTextEn: "x",
    headlineEn: "h",
    descriptionEn: "d",
    primaryTextMs: "x",
    headlineMs: "h",
    descriptionMs: "d",
  } as never;

  it("does NOT emit page_id/link_url (MCP fills them from env)", () => {
    const step = creativeStep(v, "en", spec);
    const args = step.args as Record<string, unknown>;
    expect(args.page_id).toBeUndefined();
    expect(args.link_url).toBeUndefined();
  });

  it("emits call_to_action as the bare ctaType string", () => {
    const step = creativeStep(v, "en", spec);
    expect((step.args as Record<string, unknown>).call_to_action).toBe("LEARN_MORE");
  });
});

describe("planDistribution — composition regression guard", () => {
  it("planDistribution equals mergeParts(setup, rows, yt, articles, organic) for a mixed input", () => {
    const ok = variant({ rowId: "ok", variantId: "vok", cellId: "c1" });
    const skipAd = variant({
      rowId: "skipAd",
      variantId: "vad",
      adId: { en: "x", ms: "y" },
    });
    const skipNoSpec = variant({ rowId: "skipNs", variantId: "vns", metaSpec: null });
    const skipNoCell = variant({ rowId: "skipNc", variantId: "vnc", cellId: null });
    const skipBadCell = variant({ rowId: "skipBc", variantId: "vbc", cellId: "cX" });
    const variants = [ok, skipAd, skipNoSpec, skipNoCell, skipBadCell];

    const full = planDistribution("run_1", variants, [], [cell], { dailyBudgetMyr: 100 });

    const setupPart = planMetaPaidSetup("run_1", variants, [cell], 100);
    const rowsPart = planMetaPaidRows(variants, [cell]);

    // The full plan's Meta-paid pieces must equal the concatenation of setup + rows.
    // setup field of `full` only contains Meta setup (other channels emit no setup).
    expect(full.setup).toEqual(setupPart.setup);
    // Concatenated notes / skipped from setup+rows should appear in the full plan.
    const mergedNotes = [...setupPart.notes, ...rowsPart.notes];
    const mergedSkipped = [...setupPart.skipped, ...rowsPart.skipped];
    // Only Meta-paid contributes notes/skipped here (no YT/articles/organic in fixtures).
    expect(full.notes).toEqual(mergedNotes);
    expect(full.skipped).toEqual(mergedSkipped);
    expect(full.rowPlans).toEqual(rowsPart.rowPlans);
    expect(full.backfills).toEqual(rowsPart.backfills);
  });
});

describe("dailyBudgetCentsFor", () => {
  const cell = { cellId: "cell-A", allocationPct: 70, variantPageIds: [] } as AllocatedCell;
  it("multiplies MYR by allocationPct and rounds", () => {
    expect(dailyBudgetCentsFor(cell, 10)).toBe(700);
  });
  it("floors at 1 cent for zero allocation", () => {
    expect(dailyBudgetCentsFor({ ...cell, allocationPct: 0 }, 10)).toBe(1);
  });
  it("exposes the campaign objective constant", () => {
    expect(CAMPAIGN_OBJECTIVE).toBe("OUTCOME_LEADS");
  });
});
