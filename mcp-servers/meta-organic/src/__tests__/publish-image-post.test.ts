import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../graph.js", () => ({
  graphPost: vi.fn(),
  graphGet: vi.fn(),
}));
vi.mock("../compliance.js", () => ({ preflightCompliance: vi.fn() }));
vi.mock("../auth.js", () => ({
  requireEnv: () => ({ pageId: "PAGE", igUserId: "IGU", token: "TKN" }),
}));

import { publishImagePost } from "../tools/publish-image-post.js";
import { graphPost } from "../graph.js";

describe("publishImagePost", () => {
  const NOW = 1_700_000_000;
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses scheduled_publish_time < now + 10min", async () => {
    await expect(
      publishImagePost({
        variantId: "var_a",
        platform: "ig",
        imageUrl: "https://x/y.png",
        caption: "hi",
        lang: "en",
        scheduledPublishTime: NOW + 300,
        nowUnix: NOW,
      })
    ).rejects.toThrow(/immediate_publish_disabled/);
    expect(graphPost).not.toHaveBeenCalled();
  });

  it("publishes scheduled IG image post (2 calls: container then publish-on-schedule)", async () => {
    (graphPost as any)
      .mockResolvedValueOnce({ id: "container_1" })
      .mockResolvedValueOnce({ id: "ig_media_1" });
    const res = await publishImagePost({
      variantId: "var_a",
      platform: "ig",
      imageUrl: "https://x/y.png",
      caption: "Educational PRS post.",
      lang: "en",
      scheduledPublishTime: NOW + 3600,
      nowUnix: NOW,
    });
    expect(res).toEqual({ postId: "ig_media_1", platform: "ig" });
    expect((graphPost as any).mock.calls[0][0]).toContain("IGU/media");
    expect((graphPost as any).mock.calls[1][0]).toContain("IGU/media_publish");
  });

  it("publishes scheduled FB image post (upload unpublished photo, then /feed)", async () => {
    (graphPost as any)
      .mockResolvedValueOnce({ id: "ph_1" }) // /photos unpublished upload
      .mockResolvedValueOnce({ id: "fb_post_1" }); // /feed scheduled post
    const res = await publishImagePost({
      variantId: "var_a",
      platform: "fb",
      imageUrl: "https://x/y.png",
      caption: "Educational.",
      lang: "en",
      scheduledPublishTime: NOW + 3600,
      nowUnix: NOW,
    });
    expect(res).toEqual({ postId: "fb_post_1", platform: "fb" });
    // Call 1: upload the photo unpublished — NO scheduling params here.
    const [photoUrl, photoBody] = (graphPost as any).mock.calls[0];
    expect(photoUrl).toContain("PAGE/photos");
    expect(photoBody).toMatchObject({ url: "https://x/y.png", published: false });
    expect(photoBody.scheduled_publish_time).toBeUndefined();
    // Call 2: /feed scheduled post attaching the photo.
    const [feedUrl, feedBody] = (graphPost as any).mock.calls[1];
    expect(feedUrl).toContain("PAGE/feed");
    expect(feedBody).toMatchObject({
      message: "Educational.",
      attached_media: [{ media_fbid: "ph_1" }],
      published: false,
      unpublished_content_type: "SCHEDULED",
      scheduled_publish_time: NOW + 3600,
    });
  });
});
