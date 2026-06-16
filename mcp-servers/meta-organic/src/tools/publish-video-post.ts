import { graphPost, graphGet, reelsUpload } from "../graph.js";
import { requireEnv } from "../auth.js";
import { validateScheduledPublishTime } from "../validation.js";
import { preflightCompliance } from "../compliance.js";
import type { Lang } from "@engineerdad/shared";

export type VideoArgs = {
  variantId: string;
  platform: "ig" | "fb";
  videoUrl: string;
  caption: string;
  lang: Lang;
  scheduledPublishTime: number;
  nowUnix?: number;
  pollMaxAttempts?: number; // default 60 (15s × 60 = 15min)
  pollIntervalMs?: number; // default 15_000
};

async function waitForIgReelFinish(
  creationId: string,
  args: VideoArgs
): Promise<void> {
  const max = args.pollMaxAttempts ?? 60;
  const interval = args.pollIntervalMs ?? 15_000;
  for (let i = 0; i < max; i++) {
    const s = await graphGet(`${creationId}`, { fields: "status_code" });
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR") {
      throw new Error(
        `reel_render_failed: IG container ${creationId} ERROR`
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `reel_render_pending: IG container ${creationId} did not finish within poll window`
  );
}

/** Poll a FB Reels video until its uploading phase completes (B-009).
 *  With the hosted-URL upload, Meta fetches the file asynchronously — the
 *  `finish` phase must not run until that fetch is done. */
async function waitForFbReelUpload(
  videoId: string,
  args: VideoArgs
): Promise<void> {
  const max = args.pollMaxAttempts ?? 60;
  const interval = args.pollIntervalMs ?? 15_000;
  for (let i = 0; i < max; i++) {
    const s = await graphGet(`${videoId}`, { fields: "status" });
    const phase = s.status?.uploading_phase?.status;
    if (phase === "complete") return;
    if (phase === "error") {
      throw new Error(`reel_upload_failed: FB reel ${videoId} uploading_phase error`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `reel_upload_pending: FB reel ${videoId} upload did not complete within poll window`
  );
}

export async function publishVideoPost(
  args: VideoArgs
): Promise<{ postId: string; platform: "ig" | "fb" }> {
  validateScheduledPublishTime(args.scheduledPublishTime, args.nowUnix);
  preflightCompliance({ caption: args.caption, lang: args.lang });
  const { pageId, igUserId } = requireEnv();

  if (args.platform === "ig") {
    const container = await graphPost(`${igUserId}/media`, {
      media_type: "REELS",
      video_url: args.videoUrl,
      caption: args.caption,
    });
    await waitForIgReelFinish(container.id, args);
    const published = await graphPost(`${igUserId}/media_publish`, {
      creation_id: container.id,
      scheduled_publish_time: args.scheduledPublishTime,
    });
    return { postId: published.id, platform: "ig" };
  }

  // FB Page Reel (B-009) — published via the Reels API, not /videos.
  // `/videos` produces a regular video post; `/video_reels` produces a true
  // Reel. Three-phase flow: start → upload (hosted file_url) → finish.
  // Reels accept scheduled_publish_time 10min–30 days out (tighter than the
  // 75-day feed-post window, but well inside the weekly organic cadence).
  const start = await graphPost(`${pageId}/video_reels`, {
    upload_phase: "start",
  });
  await reelsUpload(start.upload_url, args.videoUrl);
  await waitForFbReelUpload(start.video_id, args);
  await graphPost(`${pageId}/video_reels`, {
    upload_phase: "finish",
    video_id: start.video_id,
    video_state: "SCHEDULED",
    scheduled_publish_time: args.scheduledPublishTime,
    description: args.caption,
  });
  return { postId: start.video_id, platform: "fb" };
}
