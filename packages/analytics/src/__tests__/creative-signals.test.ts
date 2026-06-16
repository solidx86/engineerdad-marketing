import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb, getDb } from "../db.js";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

describe("creative_signals table", () => {
  it("has the expected columns", async () => {
    const cols = (await getDb().execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'analytics' AND table_name = 'creative_signals'
    `)) as unknown as Array<{ column_name: string }>;
    const names = cols.map((c) => c.column_name).sort();
    expect(names).toEqual(
      ["channel", "id", "kpi_name", "kpi_value", "platform", "source", "ts", "variant_id"].sort(),
    );
  });

  it("enforces UNIQUE(variant_id, channel, platform, kpi_name, ts)", async () => {
    const db = getDb();
    await db.execute(sql`
      INSERT INTO analytics.creative_signals
        (variant_id, channel, platform, kpi_name, kpi_value, ts, source)
      VALUES (${"var_1"}, ${"meta-organic"}, ${"ig"}, ${"reach"}, ${100}, ${1700000000}, ${"meta-graph"})
    `);
    await expect(
      db.execute(sql`
        INSERT INTO analytics.creative_signals
          (variant_id, channel, platform, kpi_name, kpi_value, ts, source)
        VALUES (${"var_1"}, ${"meta-organic"}, ${"ig"}, ${"reach"}, ${200}, ${1700000000}, ${"meta-graph"})
      `),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
