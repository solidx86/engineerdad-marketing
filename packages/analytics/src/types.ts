import { z } from "zod";

const ActionEntrySchema = z.object({
  action_type: z.string().optional(),
  value: z.union([z.string(), z.number()]),
});

const LEAD_ACTION_TYPES = new Set(["lead", "onsite_conversion.lead_grouped"]);
const PURCHASE_ACTION_TYPES = new Set([
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
]);

function toNumber(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function sumActions(
  arr: { action_type?: string; value: string | number }[] | undefined,
  match: Set<string>,
): number {
  if (!arr) return 0;
  let total = 0;
  for (const a of arr) {
    if (a.action_type && match.has(a.action_type)) {
      const v = toNumber(a.value);
      if (v !== undefined) total += v;
    }
  }
  return total;
}

/**
 * Canonical storage shape — what `meta_insights` rows look like in Postgres.
 * This is the OUTPUT of the input schema's transform.
 */
export interface MetaInsightRow {
  date: string;
  ad_id: string;
  adset_id?: string;
  campaign_id?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr?: number;
  cpm?: number;
  leads: number;
  purchases: number;
  value: number;
  avg_watch_sec?: number;
  raw_json?: string;
}

/**
 * Tool input schema for `ingest_meta_insights`. Accepts either:
 *
 *   (a) the canonical MetaInsightRow shape (numeric types, `date` field), or
 *   (b) raw Meta Marketing API rows from `get_insights` — string-typed numbers,
 *       `date_start`/`date_stop` instead of `date`, nested `actions[]` /
 *       `action_values[]` / `video_avg_time_watched_actions[]` arrays.
 *
 * The `.transform` canonicalises (b) → MetaInsightRow before validation passes.
 * Agents do not need to do field-mapping; they pipe the raw rows through.
 *
 * Documented in docs/decisions/006-meta-ads-mcp.md (server-side raw-row transform).
 * Originally filed as Phase 8.5 after Phase 7.3 surfaced the analytics
 * subagent's repeated failure to map `ad_id` from raw rows manually.
 */
export const MetaInsightRowSchema = z
  .object({
    ad_id: z.string(),
    adset_id: z.string().optional(),
    campaign_id: z.string().optional(),

    date: z.string().optional(),
    date_start: z.string().optional(),
    date_stop: z.string().optional(),

    spend: z.union([z.string(), z.number()]).optional(),
    impressions: z.union([z.string(), z.number()]).optional(),
    clicks: z.union([z.string(), z.number()]).optional(),
    ctr: z.union([z.string(), z.number()]).optional(),
    cpm: z.union([z.string(), z.number()]).optional(),
    cpc: z.union([z.string(), z.number()]).optional(),

    leads: z.union([z.string(), z.number()]).optional(),
    purchases: z.union([z.string(), z.number()]).optional(),
    value: z.union([z.string(), z.number()]).optional(),
    avg_watch_sec: z.union([z.string(), z.number()]).optional(),

    actions: z.array(ActionEntrySchema).optional(),
    action_values: z.array(ActionEntrySchema).optional(),
    video_avg_time_watched_actions: z.array(ActionEntrySchema).optional(),

    ad_name: z.string().optional(),
    adset_name: z.string().optional(),
    campaign_name: z.string().optional(),

    raw_json: z.string().optional(),
  })
  .passthrough()
  .transform((row, ctx): MetaInsightRow => {
    const date = row.date ?? row.date_stop ?? row.date_start;
    if (!date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "row requires `date`, `date_stop`, or `date_start`",
        path: ["date"],
      });
      return z.NEVER;
    }

    const leads =
      row.leads !== undefined ? toNumber(row.leads) ?? 0 : sumActions(row.actions, LEAD_ACTION_TYPES);
    const purchases =
      row.purchases !== undefined
        ? toNumber(row.purchases) ?? 0
        : sumActions(row.actions, PURCHASE_ACTION_TYPES);
    const value =
      row.value !== undefined
        ? toNumber(row.value) ?? 0
        : sumActions(row.action_values, PURCHASE_ACTION_TYPES);

    let avgWatchSec: number | undefined;
    if (row.avg_watch_sec !== undefined) {
      avgWatchSec = toNumber(row.avg_watch_sec);
    } else if (row.video_avg_time_watched_actions?.length) {
      const ms = toNumber(row.video_avg_time_watched_actions[0]?.value);
      avgWatchSec = ms !== undefined ? ms / 1000 : undefined;
    }

    return {
      date,
      ad_id: row.ad_id,
      adset_id: row.adset_id,
      campaign_id: row.campaign_id,
      spend: toNumber(row.spend) ?? 0,
      impressions: Math.trunc(toNumber(row.impressions) ?? 0),
      clicks: Math.trunc(toNumber(row.clicks) ?? 0),
      ctr: toNumber(row.ctr),
      cpm: toNumber(row.cpm),
      leads: Math.trunc(leads),
      purchases: Math.trunc(purchases),
      value,
      avg_watch_sec: avgWatchSec,
      raw_json: row.raw_json ?? JSON.stringify(row),
    };
  });

/** Input shape for `ingest_meta_insights`. An empty `rows` array is a valid
 *  no-op — a cold-start cycle has no Meta insights to ingest (B-013). */
export const IngestMetaInsightsInputSchema = z.object({
  rows: z.array(MetaInsightRowSchema),
});

export const CreativeSchema = z.object({
  ad_id: z.string(),
  name: z.string().optional(),
  hook: z.string().optional(),
  angle: z.string().optional(),
  persona: z.string().optional(),
  format: z.string().optional(),
  language: z.enum(["en", "ms"]).optional(),
  brief_page_id: z.string().optional(),
  variant_page_id: z.string().optional(),
  launched_at: z.string().optional(),
  tags: z
    .array(
      z.object({
        kind: z.enum(["hook", "angle", "value_seg", "persona", "format", "language"]),
        value: z.string(),
      }),
    )
    .optional(),
});

export type Creative = z.infer<typeof CreativeSchema>;

export const ArmTagSchema = z.enum(["hook", "angle", "format", "persona", "language"]);
export type ArmTag = z.infer<typeof ArmTagSchema>;
