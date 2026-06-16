import { graphGet } from "../graph.js";
import { requireEnv } from "../auth.js";

export async function getPageInsights(args: {
  sinceTs?: number;
  untilTs?: number;
  platform: "ig" | "fb";
}) {
  const { pageId, igUserId } = requireEnv();
  // Metric names verified empirically against Meta Graph v21 on 2026-05-21
  // (B-006). IG account: `profile_views` now requires metric_type=total_value
  // and can't share a call with time-series metrics, so this call carries only
  // the time-series pair (`follower_count`, `reach`). FB page: `page_fans` and
  // `page_impressions` were removed — use `page_follows` + `page_impressions_unique`.
  if (args.platform === "ig") {
    return await graphGet(`${igUserId}/insights`, {
      metric: "follower_count,reach",
      period: "day",
      since: args.sinceTs,
      until: args.untilTs,
    });
  }
  return await graphGet(`${pageId}/insights`, {
    metric: "page_impressions_unique,page_post_engagements,page_follows,page_views_total",
    period: "day",
    since: args.sinceTs,
    until: args.untilTs,
  });
}
