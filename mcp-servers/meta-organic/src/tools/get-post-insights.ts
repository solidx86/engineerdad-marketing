import { graphGet } from "../graph.js";

// Metric names verified empirically against Meta Graph v21 on 2026-05-21 (B-006).
// IG dropped `impressions` (v22+) and `plays` — both consolidated into `views`.
// FB dropped `post_impressions` and `post_engaged_users` (Nov-2025 cycle).
const IG_METRICS_FEED = [
  "reach", "views", "saved", "shares", "likes", "comments", "total_interactions",
];
// Reels share the same valid set — `views` covers what `plays` used to.
const IG_METRICS_REEL = IG_METRICS_FEED;
const FB_METRICS = ["post_impressions_unique", "post_clicks", "post_reactions_like_total"];

export async function getPostInsights(args: {
  postId: string;
  platform: "ig" | "fb";
  isReel?: boolean;
}) {
  const metrics =
    args.platform === "ig"
      ? args.isReel
        ? IG_METRICS_REEL
        : IG_METRICS_FEED
      : FB_METRICS;
  return await graphGet(`${args.postId}/insights`, { metric: metrics.join(",") });
}
