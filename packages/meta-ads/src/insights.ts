const META_API_VERSION = "v21.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const DEFAULT_INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpm",
  "cpc",
  "actions",
  "action_values",
  "video_avg_time_watched_actions",
  "date_start",
  "date_stop",
];

export interface InsightsInput {
  level: "campaign" | "adset" | "ad";
  date_preset?: "last_7d" | "last_14d" | "last_30d" | "last_90d";
  fields?: string[];
  breakdowns?: ("age" | "gender" | "placement" | "region")[];
  time_increment?: "1" | "all_days" | "monthly";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`required env var ${name} is not set`);
  return v;
}

async function metaGet<T>(path: string, query: Record<string, string>): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", requireEnv("META_TOKEN"));
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API ${res.status} GET ${path}: ${body}`);
  }
  return (await res.json()) as T;
}

interface MetaList<T> {
  data: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

function adAccountPath(): string {
  const raw = requireEnv("AD_ACCOUNT_ID").trim();
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export async function getInsights(input: InsightsInput): Promise<{ rows: unknown[] }> {
  const accountPath = adAccountPath();
  const fields = (input.fields ?? DEFAULT_INSIGHT_FIELDS).join(",");
  const query: Record<string, string> = {
    level: input.level,
    fields,
    date_preset: input.date_preset ?? "last_7d",
    limit: "100",
  };
  if (input.breakdowns && input.breakdowns.length > 0) {
    query["breakdowns"] = input.breakdowns.join(",");
  }
  // Default to daily rows on ad-level pulls so decay curves have per-day
  // resolution. Without time_increment, Meta returns one row per ad spanning
  // the whole window (date_start → date_stop), which collapses the time series.
  const timeIncrement = input.time_increment ?? (input.level === "ad" ? "1" : undefined);
  if (timeIncrement) {
    query["time_increment"] = timeIncrement;
  }
  const all: unknown[] = [];
  let path = `${accountPath}/insights`;
  let nextQuery: Record<string, string> | null = query;
  while (nextQuery) {
    const page: MetaList<unknown> = await metaGet(path, nextQuery);
    all.push(...page.data);
    if (page.paging?.next) {
      const nextUrl = new URL(page.paging.next);
      const nq: Record<string, string> = {};
      for (const [k, v] of nextUrl.searchParams.entries()) {
        if (k !== "access_token") nq[k] = v;
      }
      nextQuery = nq;
      path = nextUrl.pathname.replace(/^\/[^/]+\//, "");
    } else {
      nextQuery = null;
    }
  }
  return { rows: all };
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  objective: string;
}

export async function listCampaigns(): Promise<{ campaigns: CampaignSummary[] }> {
  const res = await metaGet<MetaList<CampaignSummary>>(`${adAccountPath()}/campaigns`, {
    fields: "id,name,status,objective",
    limit: "100",
  });
  return { campaigns: res.data };
}

export interface CreativeSummary {
  id: string;
  name?: string;
  thumbnail_url?: string;
  body?: string;
  title?: string;
}

export async function listCreatives(input: {
  ad_ids?: string[];
}): Promise<{ creatives: CreativeSummary[] }> {
  if (input.ad_ids && input.ad_ids.length > 0) {
    const out: CreativeSummary[] = [];
    for (const adId of input.ad_ids) {
      const res = await metaGet<{ creative?: CreativeSummary }>(adId, {
        fields: "creative{id,name,thumbnail_url,body,title}",
      });
      if (res.creative) out.push(res.creative);
    }
    return { creatives: out };
  }
  const res = await metaGet<MetaList<CreativeSummary>>(`${adAccountPath()}/adcreatives`, {
    fields: "id,name,thumbnail_url,body,title",
    limit: "100",
  });
  return { creatives: res.data };
}
