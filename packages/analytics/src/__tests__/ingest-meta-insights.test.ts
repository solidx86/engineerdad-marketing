import { describe, it, expect } from "vitest";
import { IngestMetaInsightsInputSchema } from "../types.js";

describe("IngestMetaInsightsInputSchema — cold-start tolerance (B-013)", () => {
  it("accepts an empty rows array (a cold-start cycle has nothing to ingest)", () => {
    expect(IngestMetaInsightsInputSchema.safeParse({ rows: [] }).success).toBe(true);
  });

  it("accepts a populated rows array", () => {
    expect(
      IngestMetaInsightsInputSchema.safeParse({
        rows: [{ ad_id: "ad_1", date: "2026-05-22" }],
      }).success,
    ).toBe(true);
  });

  it("rejects a non-array rows value", () => {
    expect(IngestMetaInsightsInputSchema.safeParse({ rows: "nope" }).success).toBe(false);
  });
});
