import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb, getDb } from "../db.js";
import { ingestMetaOrganicInsights } from "../ingest-meta-organic.js";

vi.mock("../meta-organic-client.js", () => ({
  getPostInsights: vi.fn(async ({ platform }: { platform: "ig" | "fb" }) =>
    platform === "ig"
      ? {
          data: [
            { name: "reach", values: [{ value: 500 }] },
            { name: "saved", values: [{ value: 20 }] },
          ],
        }
      : {
          data: [{ name: "post_impressions", values: [{ value: 1200 }] }],
        },
  ),
}));

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

describe("ingestMetaOrganicInsights", () => {
  it("normalizes IG + FB insights into creative_signals", async () => {
    await ingestMetaOrganicInsights({
      variants: [
        { variantId: "var_a", igPostId: "ig1", fbPostId: "fb1", isReel: false },
      ],
      nowUnix: 1_700_000_000,
    });

    const rows = (await getDb().execute(sql`
      SELECT * FROM analytics.creative_signals
      WHERE variant_id = ${"var_a"}
      ORDER BY platform, kpi_name
    `)) as unknown as Array<{
      platform: string;
      kpi_name: string;
      kpi_value: number;
      channel: string;
      source: string;
      ts: number | string;
    }>;

    expect(rows).toHaveLength(3);
    expect(
      rows.find((r) => r.platform === "fb" && r.kpi_name === "post_impressions")
        ?.kpi_value,
    ).toBe(1200);
    expect(
      rows.find((r) => r.platform === "ig" && r.kpi_name === "reach")?.kpi_value,
    ).toBe(500);
    expect(
      rows.find((r) => r.platform === "ig" && r.kpi_name === "saved")?.kpi_value,
    ).toBe(20);

    // verify fixed fields
    expect(rows[0]!.channel).toBe("meta-organic");
    expect(rows[0]!.source).toBe("meta-graph");
    expect(Number(rows[0]!.ts)).toBe(1_700_000_000);
  });

  it("is idempotent (UNIQUE conflict swallowed, row count unchanged)", async () => {
    const ingestArgs = {
      variants: [
        { variantId: "var_a", igPostId: "ig1", fbPostId: "fb1", isReel: false },
      ],
      nowUnix: 1_700_000_000,
    };

    const first = await ingestMetaOrganicInsights(ingestArgs);
    expect(first.inserted).toBe(3);
    expect(first.skipped).toBe(0);

    const second = await ingestMetaOrganicInsights(ingestArgs);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(3);

    const countRows = (await getDb().execute(sql`
      SELECT COUNT(*)::int AS c FROM analytics.creative_signals
      WHERE variant_id = ${"var_a"}
    `)) as unknown as Array<{ c: number | string }>;
    expect(Number(countRows[0]!.c)).toBe(3);
  });

  it("skips variants with no postId", async () => {
    const result = await ingestMetaOrganicInsights({
      variants: [{ variantId: "var_b" }],
      nowUnix: 1_700_000_000,
    });
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(0);
    const countRows = (await getDb().execute(sql`
      SELECT COUNT(*)::int AS c FROM analytics.creative_signals
      WHERE variant_id = ${"var_b"}
    `)) as unknown as Array<{ c: number | string }>;
    expect(Number(countRows[0]!.c)).toBe(0);
  });

  it("only processes the platform that has a postId", async () => {
    const result = await ingestMetaOrganicInsights({
      variants: [{ variantId: "var_c", igPostId: "ig_only" }],
      nowUnix: 1_700_000_000,
    });
    // IG mock returns 2 metrics; FB is skipped
    expect(result.inserted).toBe(2);
    const rows = (await getDb().execute(sql`
      SELECT platform FROM analytics.creative_signals WHERE variant_id = ${"var_c"}
    `)) as unknown as Array<{ platform: string }>;
    expect(rows.every((r) => r.platform === "ig")).toBe(true);
  });
});
