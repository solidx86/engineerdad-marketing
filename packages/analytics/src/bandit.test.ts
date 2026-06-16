import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb, getDb } from "./db.js";
import { ingestMetaInsights, upsertCreative, costPerAngle, decayCurve, topCreatives, engagementPerAngle } from "./tools.js";
import { banditAllocate, banditUpdate, betaSample } from "./bandit.js";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

// Deterministic uniform PRNG (mulberry32) so Thompson-sampling allocations are
// reproducible — banditAllocate draws from Beta posteriors via Math.random, and the
// winner of a close arm race would otherwise flip between runs (flaky in CI).
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function todayMinus(d: number): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  return t.toISOString().slice(0, 10);
}

describe("betaSample", () => {
  it("produces values in [0,1]", () => {
    for (let i = 0; i < 50; i++) {
      const v = betaSample(2, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("Beta(50,1) skews near 1, Beta(1,50) skews near 0", () => {
    let high = 0;
    let low = 0;
    for (let i = 0; i < 100; i++) {
      high += betaSample(50, 1);
      low += betaSample(1, 50);
    }
    expect(high / 100).toBeGreaterThan(0.9);
    expect(low / 100).toBeLessThan(0.1);
  });
});

describe("ingest + cost_per_angle + decay_curve + top_creatives", () => {
  it("aggregates correctly across two angles", async () => {
    await upsertCreative({
      ad_id: "ad1",
      angle: "fear",
      tags: [{ kind: "angle", value: "fear" }, { kind: "hook", value: "aspiration" }],
    });
    await upsertCreative({
      ad_id: "ad2",
      angle: "identity",
      tags: [{ kind: "angle", value: "identity" }, { kind: "hook", value: "aspiration" }],
    });
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(2), ad_id: "ad1", spend: 100, impressions: 10000, clicks: 200, leads: 5, purchases: 0, value: 0 },
        { date: todayMinus(1), ad_id: "ad1", spend: 50, impressions: 5000, clicks: 100, leads: 5, purchases: 0, value: 0 },
        { date: todayMinus(1), ad_id: "ad2", spend: 200, impressions: 20000, clicks: 300, leads: 4, purchases: 0, value: 0 },
      ],
    });
    const cpa = await costPerAngle({ window_days: 7 });
    const fear = cpa.rows.find((r) => r.angle === "fear");
    const identity = cpa.rows.find((r) => r.angle === "identity");
    expect(fear?.spend).toBe(150);
    expect(fear?.leads).toBe(10);
    expect(fear?.cpa).toBe(15);
    expect(identity?.cpa).toBe(50);

    const decay = await decayCurve({ ad_id: "ad1", metric: "ctr" });
    expect(decay.points.length).toBe(2);
    expect(decay.points[0]?.value).toBeCloseTo(0.02, 3);

    const top = await topCreatives({ window_days: 7, n: 5 });
    expect(top.rows[0]?.ad_id).toBe("ad1");
  });
});

// ── channel parameter back-compat + organic routing ──────────────────────────

async function seedOrganicSignal(
  variantId: string,
  channel: string,
  kpiValue: number,
  tsOffset = 0,
) {
  const ts = Math.floor(Date.now() / 1000) - tsOffset;
  await getDb().execute(sql`
    INSERT INTO analytics.creative_signals
      (variant_id, channel, platform, kpi_name, kpi_value, ts, source)
    VALUES (${variantId}, ${channel}, ${"ig"}, ${"reach"}, ${kpiValue}, ${ts}, ${"test"})
    ON CONFLICT DO NOTHING
  `);
}

describe("top_creatives — channel param", () => {
  it("defaults to meta-paid behavior when channel omitted", async () => {
    await upsertCreative({ ad_id: "paid1", tags: [] });
    await upsertCreative({ ad_id: "paid2", tags: [] });
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(1), ad_id: "paid1", spend: 100, impressions: 5000, clicks: 100, leads: 2, purchases: 0, value: 0 },
        { date: todayMinus(1), ad_id: "paid2", spend: 50, impressions: 2000, clicks: 40, leads: 1, purchases: 0, value: 0 },
      ],
    });
    // seed organic rows that must NOT appear in paid results
    await seedOrganicSignal("org1", "meta-organic", 999);

    const top = await topCreatives({ window_days: 7, n: 10 });
    const ids = top.rows.map((r) => r.ad_id);
    expect(ids).toContain("paid1");
    expect(ids).toContain("paid2");
    expect(ids).not.toContain("org1");
  });

  it("filters to channel='meta-organic' when supplied", async () => {
    // seed 2 organic rows + 1 paid row that must NOT appear
    await seedOrganicSignal("org_a", "meta-organic", 500);
    await seedOrganicSignal("org_b", "meta-organic", 300);
    await upsertCreative({ ad_id: "paid_x", tags: [] });
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(1), ad_id: "paid_x", spend: 200, impressions: 10000, clicks: 200, leads: 5, purchases: 0, value: 0 },
      ],
    });

    const top = await topCreatives({ window_days: 7, n: 10, channel: "meta-organic" });
    const ids = top.rows.map((r) => r.ad_id);
    expect(ids).toContain("org_a");
    expect(ids).toContain("org_b");
    expect(ids).not.toContain("paid_x");
    // highest kpi sum should rank first
    expect(top.rows[0]?.ad_id).toBe("org_a");
  });
});

describe("decay_curve — channel param", () => {
  it("defaults to meta-paid behavior when channel omitted", async () => {
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(2), ad_id: "paid_d1", spend: 80, impressions: 4000, clicks: 80, leads: 2, purchases: 0, value: 0 },
        { date: todayMinus(1), ad_id: "paid_d1", spend: 40, impressions: 2000, clicks: 40, leads: 1, purchases: 0, value: 0 },
      ],
    });
    // organic signal for same variant_id — must not bleed into paid result
    await seedOrganicSignal("paid_d1", "meta-organic", 777);

    const decay = await decayCurve({ ad_id: "paid_d1", metric: "ctr" });
    expect(decay.points.length).toBe(2);
    // each point value should be CTR ~= 80/4000 = 0.02
    expect(decay.points[0]?.value).toBeCloseTo(0.02, 3);
  });

  it("filters to channel='meta-organic' when supplied", async () => {
    const db = getDb();
    // Insert 2 organic rows for "var_org" at distinct timestamps (different seconds)
    const tsBase = Math.floor(Date.now() / 1000);
    await db.execute(sql`
      INSERT INTO analytics.creative_signals
        (variant_id, channel, platform, kpi_name, kpi_value, ts, source)
      VALUES (${"var_org"}, ${"meta-organic"}, ${"ig"}, ${"reach"}, ${400}, ${tsBase - 10000}, ${"test"})
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO analytics.creative_signals
        (variant_id, channel, platform, kpi_name, kpi_value, ts, source)
      VALUES (${"var_org"}, ${"meta-organic"}, ${"ig"}, ${"saved"}, ${80}, ${tsBase - 5000}, ${"test"})
      ON CONFLICT DO NOTHING
    `);
    // paid row that must NOT appear
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(1), ad_id: "var_org", spend: 50, impressions: 1000, clicks: 10, leads: 0, purchases: 0, value: 0 },
      ],
    });

    const decay = await decayCurve({ ad_id: "var_org", metric: "ctr", channel: "meta-organic" });
    // organic path returns aggregated kpi_value per day; at minimum 1 point
    expect(decay.points.length).toBeGreaterThanOrEqual(1);
    // total sum across all points should include both organic kpi values
    const total = decay.points.reduce((s, p) => s + p.value, 0);
    expect(total).toBeCloseTo(480, 0); // 400 + 80
  });
});

describe("cost_per_angle — channel param", () => {
  it("defaults to meta-paid behavior when channel omitted", async () => {
    await upsertCreative({
      ad_id: "cpa_ad1",
      angle: "aspiration",
      tags: [{ kind: "angle", value: "aspiration" }],
    });
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(1), ad_id: "cpa_ad1", spend: 120, impressions: 6000, clicks: 120, leads: 3, purchases: 0, value: 0 },
      ],
    });
    // organic row — must NOT appear in paid result
    await seedOrganicSignal("cpa_ad1", "meta-organic", 999);

    const result = await costPerAngle({ window_days: 7 });
    const row = result.rows.find((r) => r.angle === "aspiration");
    expect(row).toBeDefined();
    expect(row?.spend).toBe(120);
    expect(row?.leads).toBe(3);
    expect(row?.cpa).toBe(40);
  });

  it("filters to channel='meta-organic' when supplied", async () => {
    // 2 organic variants tagged with angle, 1 paid variant
    await upsertCreative({
      ad_id: "org_cpa1",
      angle: "curiosity",
      tags: [{ kind: "angle", value: "curiosity" }],
    });
    await upsertCreative({
      ad_id: "org_cpa2",
      angle: "curiosity",
      tags: [{ kind: "angle", value: "curiosity" }],
    });
    await upsertCreative({
      ad_id: "paid_cpa",
      angle: "fear",
      tags: [{ kind: "angle", value: "fear" }],
    });
    await seedOrganicSignal("org_cpa1", "meta-organic", 600);
    await seedOrganicSignal("org_cpa2", "meta-organic", 400);
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(1), ad_id: "paid_cpa", spend: 300, impressions: 15000, clicks: 300, leads: 6, purchases: 0, value: 0 },
      ],
    });

    const result = await costPerAngle({ window_days: 7, channel: "meta-organic" });
    const angles = result.rows.map((r) => r.angle);
    expect(angles).toContain("curiosity");
    expect(angles).not.toContain("fear");

    const curiosityRow = result.rows.find((r) => r.angle === "curiosity");
    expect(curiosityRow?.n_creatives).toBe(2);
    expect(curiosityRow?.spend).toBeCloseTo(1000, 0); // 600 + 400
  });
});

describe("bandit_allocate", () => {
  beforeEach(async () => {
    // Seed Math.random so the Thompson-sampling winner is deterministic across runs.
    vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
    await upsertCreative({
      ad_id: "a", tags: [{ kind: "hook", value: "aspiration" }, { kind: "angle", value: "identity" }],
    });
    await upsertCreative({
      ad_id: "b", tags: [{ kind: "hook", value: "aspiration" }, { kind: "angle", value: "fear" }],
    });
    await upsertCreative({
      ad_id: "c", tags: [{ kind: "hook", value: "curiosity" }, { kind: "angle", value: "identity" }],
    });
    await ingestMetaInsights({
      rows: [
        { date: todayMinus(1), ad_id: "a", spend: 200, impressions: 20000, clicks: 400, leads: 30, purchases: 0, value: 0 },
        { date: todayMinus(1), ad_id: "b", spend: 200, impressions: 20000, clicks: 400, leads: 5, purchases: 0, value: 0 },
        { date: todayMinus(1), ad_id: "c", spend: 200, impressions: 20000, clicks: 400, leads: 10, purchases: 0, value: 0 },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("budget shares sum to ~1, winner gets the largest share", async () => {
    const out = await banditAllocate({
      arm_tags: ["hook", "angle"],
      window_days: 7,
      budget_total_myr: 1000,
      exploration_weight: 0.2,
    });
    expect(out.allocations.length).toBe(3);
    const total = out.allocations.reduce((s, a) => s + a.budget_share, 0);
    expect(total).toBeCloseTo(1, 1);
    const top = out.allocations[0]!;
    expect(top.arm["hook"]).toBe("aspiration");
    expect(top.arm["angle"]).toBe("identity");
    expect(top.bucket_label).toBe("70");
  });

  it("uniform exploration_weight=1 yields equal shares", async () => {
    const out = await banditAllocate({
      arm_tags: ["hook", "angle"],
      window_days: 7,
      budget_total_myr: 1000,
      exploration_weight: 1,
    });
    const shares = out.allocations.map((a) => a.budget_share);
    for (const s of shares) expect(s).toBeCloseTo(1 / shares.length, 2);
  });

  it("returns empty allocation + note when no arms have all required tags", async () => {
    const out = await banditAllocate({
      arm_tags: ["persona"],
      window_days: 7,
      budget_total_myr: 1000,
    });
    expect(out.allocations).toEqual([]);
    expect(out.notes.some((n) => n.includes("no creatives"))).toBe(true);
  });
});

describe("bandit_update", () => {
  it("returns posteriors with monotonic structure", async () => {
    await upsertCreative({ ad_id: "x", tags: [{ kind: "hook", value: "fear" }, { kind: "angle", value: "fear" }] });
    await ingestMetaInsights({
      rows: [{ date: todayMinus(1), ad_id: "x", spend: 100, impressions: 5000, clicks: 100, leads: 10, purchases: 0, value: 0 }],
    });
    const out = await banditUpdate({ window_days: 7, arm_tags: ["hook", "angle"] });
    expect(out.arms_updated).toBe(1);
    const p = out.posteriors[0]!;
    expect(p.alpha).toBeGreaterThan(0);
    expect(p.beta).toBeGreaterThan(0);
    expect(p.posterior_mean_cpa).toBeGreaterThan(0);
  });
});

// ── engagement_per_angle ──────────────────────────────────────────────────────

async function seedSignal(
  variantId: string,
  channel: string,
  kpiName: string,
  kpiValue: number,
  ts: number,
) {
  await getDb().execute(sql`
    INSERT INTO analytics.creative_signals
      (variant_id, channel, platform, kpi_name, kpi_value, ts, source)
    VALUES (${variantId}, ${channel}, ${"ig"}, ${kpiName}, ${kpiValue}, ${ts}, ${"test"})
    ON CONFLICT DO NOTHING
  `);
}

describe("engagement_per_angle", () => {
  it("aggregates engagement KPIs per angle, sorted descending", async () => {
    const now = Math.floor(Date.now() / 1000);
    const since = now - 3600;

    // angle "authenticity": var_a (saved=200, reach=800) + var_b (shares=100) → total 1100
    await seedSignal("var_a", "meta-organic", "saved", 200, now - 60);
    await seedSignal("var_a", "meta-organic", "reach", 800, now - 59);
    await seedSignal("var_b", "meta-organic", "shares", 100, now - 58);
    // angle "aspiration": var_c (reach=500) → total 500
    await seedSignal("var_c", "meta-organic", "reach", 500, now - 57);

    const result = await engagementPerAngle({
      channel: "meta-organic",
      sinceTs: since,
      angleByVariant: { var_a: "authenticity", var_b: "authenticity", var_c: "aspiration" },
    });

    expect(result.length).toBe(2);
    expect(result[0]!.angle).toBe("authenticity");
    expect(result[0]!.total).toBeCloseTo(1100, 0);
    expect(result[0]!.variantCount).toBe(2);
    expect(result[1]!.angle).toBe("aspiration");
    expect(result[1]!.total).toBeCloseTo(500, 0);
    expect(result[1]!.variantCount).toBe(1);
  });

  it("ignores variants not in angleByVariant map", async () => {
    const now = Math.floor(Date.now() / 1000);
    const since = now - 3600;

    await seedSignal("mapped_v", "meta-organic", "saved", 300, now - 60);
    // unmapped variant — must not contribute
    await seedSignal("unmapped_v", "meta-organic", "saved", 999, now - 59);

    const result = await engagementPerAngle({
      channel: "meta-organic",
      sinceTs: since,
      angleByVariant: { mapped_v: "curiosity" },
    });

    expect(result.length).toBe(1);
    expect(result[0]!.angle).toBe("curiosity");
    expect(result[0]!.total).toBeCloseTo(300, 0);
  });

  it("respects sinceTs filter", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 1000;

    // row before cutoff — must be excluded
    await seedSignal("ts_v", "meta-organic", "reach", 9999, cutoff - 100);
    // row after cutoff — must be included
    await seedSignal("ts_v", "meta-organic", "saved", 50, cutoff + 100);

    const result = await engagementPerAngle({
      channel: "meta-organic",
      sinceTs: cutoff,
      angleByVariant: { ts_v: "fear" },
    });

    expect(result.length).toBe(1);
    expect(result[0]!.total).toBeCloseTo(50, 0);
  });
});
