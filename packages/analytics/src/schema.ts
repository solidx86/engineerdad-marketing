// E-034 — analytics signals + bandit state, Postgres-resident.
// Single source of truth for the analytics schema; consumed by db.ts (runtime)
// and drizzle-kit (migrations).
//
// Type notes:
//   - JSON columns are jsonb (raw_json, payload_json).
//   - `ts` columns are bigint, NOT timestamptz — bandit decay math and
//     time-window queries operate on raw numeric epoch values. Unit differs
//     per table:
//       events.ts          — epoch-MILLISECONDS (logEvent writes Date.now())
//       creative_signals.ts — epoch-SECONDS (writers use Math.floor(Date.now()/1000);
//                             readers like decayCurve use to_timestamp(ts))
//     The mismatch is intentional-by-inheritance from the v1 schema; do not
//     unify without a coordinated reader+writer migration.
//   - Auto-increment PK is bigserial.
import {
  pgSchema, text, integer, real, jsonb, bigint, bigserial, primaryKey, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

export const metaInsights = analyticsSchema.table(
  "meta_insights",
  {
    date: text("date").notNull(),
    adId: text("ad_id").notNull(),
    adsetId: text("adset_id"),
    campaignId: text("campaign_id"),
    spend: real("spend"),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    ctr: real("ctr"),
    cpm: real("cpm"),
    leads: integer("leads"),
    purchases: integer("purchases"),
    value: real("value"),
    avgWatchSec: real("avg_watch_sec"),
    rawJson: jsonb("raw_json"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.date, t.adId] }),
    adIdx: index("meta_insights_ad_idx").on(t.adId),
    dateIdx: index("meta_insights_date_idx").on(t.date),
  }),
);

export const creatives = analyticsSchema.table("creatives", {
  adId: text("ad_id").primaryKey(),
  name: text("name"),
  hook: text("hook"),
  angle: text("angle"),
  persona: text("persona"),
  format: text("format"),
  language: text("language"),
  briefPageId: text("brief_page_id"),
  variantPageId: text("variant_page_id"),
  launchedAt: text("launched_at"),
});

export const events = analyticsSchema.table(
  "events",
  {
    id: text("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    eventName: text("event_name").notNull(),
    source: text("source"),
    payloadJson: jsonb("payload_json"),
  },
  (t) => ({
    tsIdx: index("events_ts_idx").on(t.ts),
    nameIdx: index("events_name_idx").on(t.eventName),
  }),
);

export const angleTags = analyticsSchema.table(
  "angle_tags",
  {
    adId: text("ad_id").notNull(),
    tagKind: text("tag_kind").notNull(),
    tagValue: text("tag_value").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.adId, t.tagKind, t.tagValue] }),
    kindIdx: index("angle_tags_kind_idx").on(t.tagKind, t.tagValue),
  }),
);

export const creativeSignals = analyticsSchema.table(
  "creative_signals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    variantId: text("variant_id").notNull(),
    channel: text("channel").notNull(),
    platform: text("platform"),
    kpiName: text("kpi_name").notNull(),
    kpiValue: real("kpi_value").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    source: text("source").notNull(),
  },
  (t) => ({
    unique: uniqueIndex("creative_signals_dedup_idx")
      .on(t.variantId, t.channel, t.platform, t.kpiName, t.ts),
    variantIdx: index("creative_signals_variant_idx").on(t.variantId),
    channelTsIdx: index("creative_signals_channel_ts_idx").on(t.channel, t.ts),
  }),
);
