import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../graph.js", () => ({ graphPost: vi.fn(), graphGet: vi.fn(), reelsUpload: vi.fn() }));
vi.mock("../compliance.js", () => ({ preflightCompliance: vi.fn() }));
vi.mock("../auth.js", () => ({
  requireEnv: () => ({ pageId: "PAGE", igUserId: "IGU", token: "TKN" }),
}));

import { publishVideoPost } from "../tools/publish-video-post.js";
import { graphPost, graphGet, reelsUpload } from "../graph.js";

describe("publishVideoPost", () => {
  const NOW = 1_700_000_000;
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("IG Reel: container with REELS + waits for FINISHED + publishes", async () => {
    (graphPost as any).mockResolvedValueOnce({ id: "c_reel" });
    (graphGet as any).mockResolvedValueOnce({ status_code: "FINISHED" });
    (graphPost as any).mockResolvedValueOnce({ id: "reel_pub" });
    const res = await publishVideoPost({
      variantId: "var_a",
      platform: "ig",
      videoUrl: "https://x/r.mp4",
      caption: "hi",
      lang: "en",
      scheduledPublishTime: NOW + 3600,
      nowUnix: NOW,
    });
    expect(res).toEqual({ postId: "reel_pub", platform: "ig" });
    expect((graphPost as any).mock.calls[0][1]).toMatchObject({
      media_type: "REELS",
      video_url: "https://x/r.mp4",
    });
  });

  it("FB Reel: start → upload → poll → finish (scheduled via /video_reels)", async () => {
    (graphPost as any)
      .mockResolvedValueOnce({
        video_id: "vid_1",
        upload_url: "https://rupload.facebook.com/video-upload/v21.0/vid_1",
      }) // start
      .mockResolvedValueOnce({ success: true }); // finish
    (reelsUpload as any).mockResolvedValueOnce({ success: true });
    (graphGet as any).mockResolvedValueOnce({
      status: { uploading_phase: { status: "complete" } },
    });
    const res = await publishVideoPost({
      variantId: "var_a",
      platform: "fb",
      videoUrl: "https://x/r.mp4",
      caption: "hi",
      lang: "en",
      scheduledPublishTime: NOW + 3600,
      nowUnix: NOW,
    });
    expect(res).toEqual({ postId: "vid_1", platform: "fb" });
    // start phase
    expect((graphPost as any).mock.calls[0][0]).toContain("PAGE/video_reels");
    expect((graphPost as any).mock.calls[0][1]).toMatchObject({ upload_phase: "start" });
    // upload phase — hosted file_url to the rupload URL
    expect((reelsUpload as any).mock.calls[0]).toEqual([
      "https://rupload.facebook.com/video-upload/v21.0/vid_1",
      "https://x/r.mp4",
    ]);
    // finish phase — scheduled
    expect((graphPost as any).mock.calls[1][1]).toMatchObject({
      upload_phase: "finish",
      video_id: "vid_1",
      video_state: "SCHEDULED",
      scheduled_publish_time: NOW + 3600,
      description: "hi",
    });
  });

  it("IG: throws reel_render_failed when status_code = ERROR", async () => {
    (graphPost as any).mockResolvedValueOnce({ id: "c_reel" });
    (graphGet as any).mockResolvedValueOnce({ status_code: "ERROR" });
    await expect(
      publishVideoPost({
        variantId: "var_a",
        platform: "ig",
        videoUrl: "https://x/r.mp4",
        caption: "hi",
        lang: "en",
        scheduledPublishTime: NOW + 3600,
        nowUnix: NOW,
      })
    ).rejects.toThrow(/reel_render_failed/);
  });

  it("IG: throws reel_render_pending after max poll attempts", async () => {
    (graphPost as any).mockResolvedValueOnce({ id: "c_reel" });
    // never returns FINISHED; pollMaxAttempts: 2 means 2 polls then timeout
    (graphGet as any).mockResolvedValue({ status_code: "IN_PROGRESS" });
    await expect(
      publishVideoPost({
        variantId: "var_a",
        platform: "ig",
        videoUrl: "https://x/r.mp4",
        caption: "hi",
        lang: "en",
        scheduledPublishTime: NOW + 3600,
        nowUnix: NOW,
        pollMaxAttempts: 2,
        pollIntervalMs: 1, // fast for test
      })
    ).rejects.toThrow(/reel_render_pending/);
  });

  it("rejects scheduled_publish_time < now + 10min", async () => {
    await expect(
      publishVideoPost({
        variantId: "var_a",
        platform: "ig",
        videoUrl: "https://x/r.mp4",
        caption: "hi",
        lang: "en",
        scheduledPublishTime: NOW + 100,
        nowUnix: NOW,
      })
    ).rejects.toThrow(/immediate_publish_disabled/);
  });
});
