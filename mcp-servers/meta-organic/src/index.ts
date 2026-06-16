import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { publishImagePost } from "./tools/publish-image-post.js";
import { publishCarouselPost } from "./tools/publish-carousel-post.js";
import { publishVideoPost } from "./tools/publish-video-post.js";
import { getPostStatus } from "./tools/get-post-status.js";
import { getPostInsights } from "./tools/get-post-insights.js";
import { getPageInsights } from "./tools/get-page-insights.js";
import { cancelScheduledPost } from "./tools/cancel-scheduled-post.js";
import { deletePost } from "./tools/delete-post.js";
import { isIgPublishDisabled, IG_DISABLED_MSG } from "./ig-guard.js";

const server = new McpServer({ name: "meta-organic", version: "0.1.0" });

const toolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const errorResult = (err: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: err instanceof Error ? err.message : String(err),
    },
  ],
});

const platformEnum = z.enum(["ig", "fb"]);
const langEnum = z.enum(["en", "ms"]);

// ════════════════════════════════════════════════════════════════════════════
// PUBLISH TOOLS (ADR-019 schedule-only safety doctrine)
// All publish tools schedule the post — they never immediately publish.
// Activation / immediate publishing is a human-only action.
// ════════════════════════════════════════════════════════════════════════════

server.tool(
  "publish_image_post",
  "Publish a scheduled image post to FB Page. Schedule-only (ADR-019). Runs compliance preflight on caption before posting. NOTE: platform 'ig' is disabled (B-005 — Meta has no IG scheduled-post API); IG posts go out manually from the webapp posting pack (/posting-pack/organic/<runId>) until E-024.",
  {
    variantId: z.string().min(1),
    platform: platformEnum,
    imageUrl: z.string().url(),
    caption: z.string().min(1),
    lang: langEnum,
    scheduledPublishTime: z.number().int(),
  },
  async (args) => {
    if (isIgPublishDisabled(args.platform)) {
      return errorResult(new Error(IG_DISABLED_MSG));
    }
    try {
      return toolResult(await publishImagePost(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "publish_carousel_post",
  "Publish a scheduled carousel post to FB Page (attached_media). Schedule-only (ADR-019). Runs compliance preflight on caption before posting. Accepts 2–10 image URLs. NOTE: platform 'ig' is disabled (B-005 — Meta has no IG scheduled-post API); IG carousels go out manually from the webapp posting pack (/posting-pack/organic/<runId>) until E-024.",
  {
    variantId: z.string().min(1),
    platform: platformEnum,
    imageUrls: z.array(z.string().url()).min(2).max(10),
    caption: z.string().min(1),
    lang: langEnum,
    scheduledPublishTime: z.number().int(),
  },
  async (args) => {
    if (isIgPublishDisabled(args.platform)) {
      return errorResult(new Error(IG_DISABLED_MSG));
    }
    try {
      return toolResult(await publishCarouselPost(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "publish_video_post",
  "Publish a scheduled video to FB Page. Schedule-only (ADR-019). Runs compliance preflight on caption. NOTE: platform 'ig' (Reels) is disabled (B-005 — Meta has no IG scheduled-post API); IG Reels go out manually from the webapp posting pack (/posting-pack/organic/<runId>) until E-024.",
  {
    variantId: z.string().min(1),
    platform: platformEnum,
    videoUrl: z.string().url(),
    caption: z.string().min(1),
    lang: langEnum,
    scheduledPublishTime: z.number().int(),
  },
  async (args) => {
    if (isIgPublishDisabled(args.platform)) {
      return errorResult(new Error(IG_DISABLED_MSG));
    }
    try {
      return toolResult(await publishVideoPost(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// READ TOOLS — post status, post insights, page insights
// ════════════════════════════════════════════════════════════════════════════

server.tool(
  "get_post_status",
  "Read the scheduled/published state of a previously-published post. Returns status, scheduled_publish_time, and permalink.",
  {
    postId: z.string().min(1),
    platform: platformEnum,
  },
  async (args) => {
    try {
      return toolResult(await getPostStatus(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_post_insights",
  "Read engagement insights for a published post. For IG Reels, pass isReel=true to include plays and total_interactions in addition to standard feed metrics.",
  {
    postId: z.string().min(1),
    platform: platformEnum,
    isReel: z.boolean().optional(),
  },
  async (args) => {
    try {
      return toolResult(await getPostInsights(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_page_insights",
  "Read page-level insights (follower delta, page views, reach) for the configured IG account or FB Page. Optionally scope to a Unix timestamp window with sinceTs/untilTs.",
  {
    platform: platformEnum,
    sinceTs: z.number().int().optional(),
    untilTs: z.number().int().optional(),
  },
  async (args) => {
    try {
      return toolResult(await getPageInsights(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// DELETION TOOLS — cancel scheduled, delete published
// ════════════════════════════════════════════════════════════════════════════

server.tool(
  "cancel_scheduled_post",
  "Cancel a scheduled post before it publishes by deleting the scheduled object. Pass the postId returned by publish_image_post / publish_carousel_post / publish_video_post.",
  {
    postId: z.string().min(1),
  },
  async (args) => {
    try {
      return toolResult(await cancelScheduledPost(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "delete_post",
  "Delete a published post from IG or FB. Irreversible — use cancel_scheduled_post for posts that have not yet published.",
  {
    postId: z.string().min(1),
  },
  async (args) => {
    try {
      return toolResult(await deletePost(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
