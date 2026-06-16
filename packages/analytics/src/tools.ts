import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { metaInsights, creatives, angleTags, events } from "./schema.js";
import type { Creative, MetaInsightRow } from "./types.js";

export async function ingestMetaInsights(input: { rows: MetaInsightRow[] }): Promise<{ rows: number }> {
  if (input.rows.length === 0) return { rows: 0 };
  const db = getDb();
  // Drizzle upsert against (date, ad_id) primary key. raw_json is jsonb in the
  // new schema, so an object/string value goes straight in; null stays null.
  let n = 0;
  for (const r of input.rows) {
    await db
      .insert(metaInsights)
      .values({
        date: r.date,
        adId: r.ad_id,
        adsetId: r.adset_id ?? null,
        campaignId: r.campaign_id ?? null,
        spend: r.spend ?? 0,
        impressions: r.impressions ?? 0,
        clicks: r.clicks ?? 0,
        ctr: r.ctr ?? null,
        cpm: r.cpm ?? null,
        leads: r.leads ?? 0,
        purchases: r.purchases ?? 0,
        value: r.value ?? 0,
        avgWatchSec: r.avg_watch_sec ?? null,
        rawJson: r.raw_json ?? null,
      })
      .onConflictDoUpdate({
        target: [metaInsights.date, metaInsights.adId],
        set: {
          adsetId: r.adset_id ?? null,
          campaignId: r.campaign_id ?? null,
          spend: r.spend ?? 0,
          impressions: r.impressions ?? 0,
          clicks: r.clicks ?? 0,
          ctr: r.ctr ?? null,
          cpm: r.cpm ?? null,
          leads: r.leads ?? 0,
          purchases: r.purchases ?? 0,
          value: r.value ?? 0,
          avgWatchSec: r.avg_watch_sec ?? null,
          rawJson: r.raw_json ?? null,
        },
      });
    n++;
  }
  return { rows: n };
}

export async function upsertCreative(input: Creative): Promise<{ ok: true; ad_id: string }> {
  const db = getDb();
  await db
    .insert(creatives)
    .values({
      adId: input.ad_id,
      name: input.name ?? null,
      hook: input.hook ?? null,
      angle: input.angle ?? null,
      persona: input.persona ?? null,
      format: input.format ?? null,
      language: input.language ?? null,
      briefPageId: input.brief_page_id ?? null,
      variantPageId: input.variant_page_id ?? null,
      launchedAt: input.launched_at ?? null,
    })
    .onConflictDoUpdate({
      target: creatives.adId,
      set: {
        name: input.name ?? null,
        hook: input.hook ?? null,
        angle: input.angle ?? null,
        persona: input.persona ?? null,
        format: input.format ?? null,
        language: input.language ?? null,
        briefPageId: input.brief_page_id ?? null,
        variantPageId: input.variant_page_id ?? null,
        launchedAt: input.launched_at ?? null,
      },
    });
  if (input.tags && input.tags.length > 0) {
    await db.execute(sql`DELETE FROM analytics.angle_tags WHERE ad_id = ${input.ad_id}`);
    for (const t of input.tags) {
      await db
        .insert(angleTags)
        .values({ adId: input.ad_id, tagKind: t.kind, tagValue: t.value })
        .onConflictDoNothing();
    }
  }
  return { ok: true, ad_id: input.ad_id };
}

export type DecayMetric = "ctr" | "cpm" | "cpa";

export async function decayCurve(input: { ad_id: string; metric: DecayMetric; channel?: string }): Promise<{
  points: Array<{ day: string; value: number }>;
}> {
  const db = getDb();
  const channel = input.channel ?? "meta-paid";

  if (channel !== "meta-paid") {
    // organic path: aggregate kpi_value per day from creative_signals
    // ts is bigint seconds; to_timestamp + ::date renders YYYY-MM-DD.
    const rows = (await db.execute(sql`
      SELECT to_char(to_timestamp(ts), 'YYYY-MM-DD') AS day,
             kpi_name,
             SUM(kpi_value) AS total
      FROM analytics.creative_signals
      WHERE variant_id = ${input.ad_id} AND channel = ${channel}
      GROUP BY day, kpi_name
      ORDER BY day ASC
    `)) as unknown as Array<{ day: string; kpi_name: string; total: number | string }>;
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const prev = byDay.get(r.day) ?? 0;
      byDay.set(r.day, prev + Number(r.total));
    }
    const points = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, value }));
    return { points };
  }

  // paid path (original behavior, unchanged)
  const rows = (await db.execute(sql`
    SELECT date, spend, impressions, clicks, leads, ctr, cpm
    FROM analytics.meta_insights
    WHERE ad_id = ${input.ad_id}
    ORDER BY date ASC
  `)) as unknown as Array<{
    date: string;
    spend: number | string | null;
    impressions: number | string | null;
    clicks: number | string | null;
    leads: number | string | null;
    ctr: number | string | null;
    cpm: number | string | null;
  }>;
  const points = rows.map((r) => {
    const spend = r.spend != null ? Number(r.spend) : 0;
    const impressions = r.impressions != null ? Number(r.impressions) : 0;
    const clicks = r.clicks != null ? Number(r.clicks) : 0;
    const leads = r.leads != null ? Number(r.leads) : 0;
    const ctrVal = r.ctr != null ? Number(r.ctr) : null;
    const cpmVal = r.cpm != null ? Number(r.cpm) : null;
    let value = 0;
    if (input.metric === "ctr") {
      value = ctrVal ?? (impressions > 0 ? clicks / impressions : 0);
    } else if (input.metric === "cpm") {
      value = cpmVal ?? (impressions > 0 ? (spend / impressions) * 1000 : 0);
    } else {
      value = leads > 0 ? spend / leads : 0;
    }
    return { day: r.date, value };
  });
  return { points };
}

export async function costPerAngle(input: { window_days: number; channel?: string }): Promise<{
  rows: Array<{ angle: string; cpa: number; spend: number; leads: number; n_creatives: number }>;
}> {
  const db = getDb();
  const channel = input.channel ?? "meta-paid";

  if (channel !== "meta-paid") {
    // organic path: group by angle tag via creative_signals + angle_tags join
    const sinceTs = Math.floor(Date.now() / 1000) - input.window_days * 86400;
    const rows = (await db.execute(sql`
      SELECT t.tag_value AS angle,
             SUM(cs.kpi_value) AS spend,
             COUNT(DISTINCT cs.variant_id) AS n_creatives
      FROM analytics.creative_signals cs
      JOIN analytics.angle_tags t ON t.ad_id = cs.variant_id AND t.tag_kind = 'angle'
      WHERE cs.channel = ${channel} AND cs.ts >= ${sinceTs}
      GROUP BY t.tag_value
      ORDER BY SUM(cs.kpi_value) DESC
    `)) as unknown as Array<{ angle: string; spend: number | string | null; n_creatives: number | string | null }>;
    return {
      rows: rows.map((r) => ({
        angle: r.angle,
        spend: r.spend != null ? Number(r.spend) : 0,
        leads: 0,        // organic signals have no lead conversion data
        n_creatives: r.n_creatives != null ? Number(r.n_creatives) : 0,
        cpa: 0,          // CPA undefined for organic (no spend/lead model)
      })),
    };
  }

  // paid path (original behavior, unchanged)
  const since = isoDaysAgo(input.window_days);
  const rows = (await db.execute(sql`
    SELECT t.tag_value AS angle,
           SUM(mi.spend) AS spend,
           SUM(mi.leads) AS leads,
           COUNT(DISTINCT mi.ad_id) AS n_creatives
    FROM analytics.meta_insights mi
    JOIN analytics.angle_tags t ON t.ad_id = mi.ad_id AND t.tag_kind = 'angle'
    WHERE mi.date >= ${since}
    GROUP BY t.tag_value
    ORDER BY (CASE WHEN SUM(mi.leads) > 0 THEN SUM(mi.spend) / SUM(mi.leads) ELSE 1e18 END) ASC
  `)) as unknown as Array<{ angle: string; spend: number | string | null; leads: number | string | null; n_creatives: number | string | null }>;
  return {
    rows: rows.map((r) => {
      const spend = r.spend != null ? Number(r.spend) : 0;
      const leads = r.leads != null ? Number(r.leads) : 0;
      const n_creatives = r.n_creatives != null ? Number(r.n_creatives) : 0;
      return {
        angle: r.angle,
        spend,
        leads,
        n_creatives,
        cpa: leads > 0 ? spend / leads : 0,
      };
    }),
  };
}

export async function topCreatives(input: { window_days: number; n: number; channel?: string }): Promise<{
  rows: Array<{ ad_id: string; name: string | null; score: number; reason: string }>;
}> {
  const db = getDb();
  const channel = input.channel ?? "meta-paid";

  if (channel !== "meta-paid") {
    // organic path: rank by total kpi_value sum from creative_signals
    const sinceTs = Math.floor(Date.now() / 1000) - input.window_days * 86400;
    const rows = (await db.execute(sql`
      SELECT cs.variant_id AS ad_id,
             c.name,
             SUM(cs.kpi_value) AS total_kpi
      FROM analytics.creative_signals cs
      LEFT JOIN analytics.creatives c ON c.ad_id = cs.variant_id
      WHERE cs.channel = ${channel} AND cs.ts >= ${sinceTs}
      GROUP BY cs.variant_id, c.name
      ORDER BY total_kpi DESC
      LIMIT ${input.n}
    `)) as unknown as Array<{
      ad_id: string;
      name: string | null;
      total_kpi: number | string | null;
    }>;
    return {
      rows: rows.map((r) => {
        const total = r.total_kpi != null ? Number(r.total_kpi) : 0;
        return {
          ad_id: r.ad_id,
          name: r.name,
          score: total,
          reason: `organic signal sum ${total.toFixed(0)} (channel: ${channel})`,
        };
      }),
    };
  }

  // paid path (original behavior, unchanged)
  const since = isoDaysAgo(input.window_days);
  const rows = (await db.execute(sql`
    SELECT mi.ad_id,
           c.name,
           SUM(mi.spend) AS spend,
           SUM(mi.leads) AS leads,
           SUM(mi.impressions) AS impressions,
           SUM(mi.clicks) AS clicks
    FROM analytics.meta_insights mi
    LEFT JOIN analytics.creatives c ON c.ad_id = mi.ad_id
    WHERE mi.date >= ${since}
    GROUP BY mi.ad_id, c.name
  `)) as unknown as Array<{
    ad_id: string;
    name: string | null;
    spend: number | string | null;
    leads: number | string | null;
    impressions: number | string | null;
    clicks: number | string | null;
  }>;
  const scored = rows
    .map((r) => ({
      ad_id: r.ad_id,
      name: r.name,
      spend: r.spend != null ? Number(r.spend) : 0,
      leads: r.leads != null ? Number(r.leads) : 0,
      impressions: r.impressions != null ? Number(r.impressions) : 0,
      clicks: r.clicks != null ? Number(r.clicks) : 0,
    }))
    .filter((r) => r.spend > 0)
    .map((r) => {
      const cpa = r.leads > 0 ? r.spend / r.leads : Number.POSITIVE_INFINITY;
      const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
      const score = r.leads > 0 ? 1 / cpa + ctr : ctr;
      const reason =
        r.leads > 0
          ? `CPA RM${cpa.toFixed(2)} on ${r.leads} leads (CTR ${(ctr * 100).toFixed(2)}%)`
          : `no leads yet; CTR ${(ctr * 100).toFixed(2)}%`;
      return { ad_id: r.ad_id, name: r.name, score, reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, input.n);
  return { rows: scored };
}

export async function logEvent(input: { event_name: string; payload?: unknown }): Promise<{ id: string }> {
  const db = getDb();
  const id = randomUUID();
  await db.insert(events).values({
    id,
    ts: Date.now(),
    eventName: input.event_name,
    source: "analytics-mcp",
    payloadJson: (input.payload ?? {}) as object,
  });
  return { id };
}

export async function engagementPerAngle(input: {
  channel: string;
  sinceTs: number;
  angleByVariant: Record<string, string>;
}): Promise<Array<{ angle: string; total: number; variantCount: number }>> {
  const db = getDb();
  const ENGAGEMENT_KPIS = ["saved", "shares", "reach", "engagement_rate"];
  const rows = (await db.execute(sql`
    SELECT variant_id, kpi_name, SUM(kpi_value) AS total
    FROM analytics.creative_signals
    WHERE channel = ${input.channel}
      AND ts >= ${input.sinceTs}
      AND kpi_name IN ${sql`(${sql.join(ENGAGEMENT_KPIS.map((k) => sql`${k}`), sql`, `)})`}
    GROUP BY variant_id, kpi_name
  `)) as unknown as Array<{
    variant_id: string;
    kpi_name: string;
    total: number | string | null;
  }>;

  const byAngle: Record<string, { angle: string; total: number; variantCount: number }> = {};
  for (const r of rows) {
    const angle = input.angleByVariant[r.variant_id];
    if (!angle) continue;
    byAngle[angle] ??= { angle, total: 0, variantCount: 0 };
    byAngle[angle].total += r.total != null ? Number(r.total) : 0;
  }

  // Count distinct variants per angle from the input map (captures structure even for zero-signal variants)
  const variantsByAngle: Record<string, Set<string>> = {};
  for (const [variantId, angle] of Object.entries(input.angleByVariant)) {
    if (!byAngle[angle]) continue;
    variantsByAngle[angle] ??= new Set();
    variantsByAngle[angle].add(variantId);
  }
  for (const [angle, entry] of Object.entries(byAngle)) {
    entry.variantCount = (variantsByAngle[angle] ?? new Set()).size;
  }

  return Object.values(byAngle).sort((a, b) => b.total - a.total);
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
