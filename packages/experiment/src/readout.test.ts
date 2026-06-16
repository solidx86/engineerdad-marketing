import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb, getDb } from "./db.js";
import { readout } from "./readout.js";

beforeEach(async () => {
  await truncatePg();
  const db = getDb();
  // Seed analytics.meta_insights via raw sql — schema export isn't on the
  // analytics package's subpath surface, so insert directly.
  await db.execute(sql`
    INSERT INTO analytics.meta_insights (date, ad_id, spend, impressions, clicks, leads, purchases, value)
    VALUES
      ('2026-05-01', 'control_ad_1', 200, 10000, 100, 10, 0, 0),
      ('2026-05-01', 'test_ad_1', 200, 10000, 150, 20, 0, 0),
      ('2026-05-01', 'test_ad_2', 200, 10000, 140, 18, 0, 0)
  `);
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

describe("experiment.readout", () => {
  it("computes lift vs control and recommends promotion on >20% lift with ≥30 leads", async () => {
    const out = await readout({
      experiment_id: "exp_001",
      cells: [
        { experiment_id: "exp_001", cell_id: "control", ad_ids: ["control_ad_1"], is_control: true },
        { experiment_id: "exp_001", cell_id: "treatment", ad_ids: ["test_ad_1", "test_ad_2"] },
      ],
    });
    const ctrl = out.cells.find((c) => c.cell_id === "control")!;
    const treat = out.cells.find((c) => c.cell_id === "treatment")!;
    expect(ctrl.cpa).toBe(20);
    expect(treat.leads).toBe(38);
    expect(treat.cpa).toBeCloseTo(400 / 38, 1);
    expect(treat.lift_vs_control).toBeGreaterThan(0.4);
    expect(out.recommendation).toMatch(/Promote treatment/);
  });

  it("flags low-power when sample is small", async () => {
    const out = await readout({
      experiment_id: "exp_002",
      cells: [
        { experiment_id: "exp_002", cell_id: "control", ad_ids: ["control_ad_1"], is_control: true },
      ],
    });
    expect(out.cells[0]?.significance_note).toMatch(/low-power/);
  });
});
