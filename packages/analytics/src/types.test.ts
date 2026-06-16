import { describe, expect, it } from "vitest";
import { MetaInsightRowSchema } from "./types.js";

describe("MetaInsightRowSchema (Phase 8.5 server-side raw transform)", () => {
  it("canonicalises a raw Meta API row into MetaInsightRow", () => {
    const raw = {
      ad_id: "120240415152420472",
      ad_name: "New Awareness ad > EPF Calc",
      campaign_id: "120240415152430472",
      campaign_name: "New Awareness campaign FB",
      spend: "90.11",
      impressions: "68059",
      clicks: "347",
      ctr: "0.509852",
      cpm: "1.323998",
      date_start: "2026-04-08",
      date_stop: "2026-05-07",
      actions: [
        { action_type: "link_click", value: "27" },
        { action_type: "lead", value: "5" },
        { action_type: "page_engagement", value: "10304" },
        { action_type: "onsite_conversion.lead_grouped", value: "2" },
        { action_type: "purchase", value: "1" },
      ],
      action_values: [{ action_type: "purchase", value: "100.50" }],
      video_avg_time_watched_actions: [{ action_type: "video_view", value: "12500" }],
    };

    const out = MetaInsightRowSchema.parse(raw);

    expect(out.ad_id).toBe("120240415152420472");
    expect(out.campaign_id).toBe("120240415152430472");
    expect(out.date).toBe("2026-05-07");
    expect(out.spend).toBe(90.11);
    expect(out.impressions).toBe(68059);
    expect(out.clicks).toBe(347);
    expect(out.ctr).toBeCloseTo(0.509852);
    expect(out.cpm).toBeCloseTo(1.323998);
    expect(out.leads).toBe(7);
    expect(out.purchases).toBe(1);
    expect(out.value).toBeCloseTo(100.5);
    expect(out.avg_watch_sec).toBeCloseTo(12.5);
    expect(out.raw_json).toBeDefined();
    expect(JSON.parse(out.raw_json!).ad_name).toBe("New Awareness ad > EPF Calc");
  });

  it("passes a canonical row through (idempotent re-ingest)", () => {
    const canonical = {
      date: "2026-05-07",
      ad_id: "ad_123",
      campaign_id: "camp_456",
      spend: 12.34,
      impressions: 1000,
      clicks: 50,
      ctr: 5,
      cpm: 1.234,
      leads: 3,
      purchases: 1,
      value: 99.99,
      raw_json: '{"already":"canonical"}',
    };
    const out = MetaInsightRowSchema.parse(canonical);
    expect(out).toMatchObject({
      date: "2026-05-07",
      ad_id: "ad_123",
      spend: 12.34,
      impressions: 1000,
      leads: 3,
      purchases: 1,
      value: 99.99,
      raw_json: '{"already":"canonical"}',
    });
  });

  it("derives 0 leads when actions[] has no lead-typed entries", () => {
    const out = MetaInsightRowSchema.parse({
      ad_id: "ad_1",
      date_stop: "2026-05-07",
      spend: "10",
      actions: [{ action_type: "link_click", value: "5" }],
    });
    expect(out.leads).toBe(0);
    expect(out.purchases).toBe(0);
  });

  it("rejects rows missing both date and date_start/date_stop", () => {
    expect(() =>
      MetaInsightRowSchema.parse({ ad_id: "ad_1", spend: "10" }),
    ).toThrowError(/date|date_stop|date_start/);
  });

  it("rejects rows missing ad_id", () => {
    expect(() => MetaInsightRowSchema.parse({ date: "2026-05-07", spend: "10" })).toThrow();
  });

  it("explicit numeric fields override actions[] derivations", () => {
    const out = MetaInsightRowSchema.parse({
      ad_id: "ad_1",
      date: "2026-05-07",
      leads: 99,
      purchases: 7,
      actions: [
        { action_type: "lead", value: "1" },
        { action_type: "purchase", value: "1" },
      ],
    });
    expect(out.leads).toBe(99);
    expect(out.purchases).toBe(7);
  });

  it("integer fields are truncated to integers", () => {
    const out = MetaInsightRowSchema.parse({
      ad_id: "ad_1",
      date: "2026-05-07",
      impressions: "999.7",
      clicks: 12.9,
      leads: 3.4,
    });
    expect(out.impressions).toBe(999);
    expect(out.clicks).toBe(12);
    expect(out.leads).toBe(3);
  });
});
