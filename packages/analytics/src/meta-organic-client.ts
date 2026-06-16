// Thin wrapper around Meta Graph API for organic post insights.
// Tests mock this module wholesale.
// In production calls Graph directly — no MCP-to-MCP per spec §8.3 / ADR-018.
// Requires META_ORGANIC_ACCESS_TOKEN env var.

const GRAPH = "https://graph.facebook.com/v21.0";

// Metric names verified empirically against Meta Graph v21 on 2026-05-21 (B-006).
// IG dropped `impressions` (v22+) and `plays`; both consolidated into `views`.
// FB dropped `post_impressions` and `post_engaged_users` (Nov-2025 cycle).
const IG_POST_METRICS = "reach,views,saved,shares,likes,comments,total_interactions";
// Reels share the same valid set — `views` covers what `plays` used to.
const IG_REEL_METRICS = IG_POST_METRICS;
const FB_POST_METRICS =
  "post_impressions_unique,post_clicks,post_reactions_like_total";

export interface PostInsightsResponse {
  data: Array<{
    name: string;
    period?: string;
    values?: Array<{ value: number; end_time?: string }>;
    id?: string;
  }>;
  paging?: unknown;
}

export async function getPostInsights(args: {
  postId: string;
  platform: "ig" | "fb";
  isReel?: boolean;
}): Promise<PostInsightsResponse> {
  const token = process.env.META_ORGANIC_ACCESS_TOKEN;
  if (!token) throw new Error("META_ORGANIC_ACCESS_TOKEN not set");

  const metrics =
    args.platform === "ig"
      ? args.isReel
        ? IG_REEL_METRICS
        : IG_POST_METRICS
      : FB_POST_METRICS;

  const url = `${GRAPH}/${args.postId}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph insights error: ${res.status} ${body}`);
  }
  return res.json() as Promise<PostInsightsResponse>;
}
