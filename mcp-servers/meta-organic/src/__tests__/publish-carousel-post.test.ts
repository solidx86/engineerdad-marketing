import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../graph.js", () => ({ graphPost: vi.fn() }));
vi.mock("../compliance.js", () => ({ preflightCompliance: vi.fn() }));
vi.mock("../auth.js", () => ({
  requireEnv: () => ({ pageId: "PAGE", igUserId: "IGU", token: "TKN" }),
}));

import { publishCarouselPost } from "../tools/publish-carousel-post.js";
import { graphPost } from "../graph.js";

describe("publishCarouselPost", () => {
  const NOW = 1_700_000_000;
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("IG: creates N child containers + 1 parent + publish", async () => {
    (graphPost as any)
      .mockResolvedValueOnce({ id: "c1" })
      .mockResolvedValueOnce({ id: "c2" })
      .mockResolvedValueOnce({ id: "parent" })
      .mockResolvedValueOnce({ id: "media_x" });
    const res = await publishCarouselPost({
      variantId: "var_a",
      platform: "ig",
      imageUrls: ["https://x/1.png", "https://x/2.png"],
      caption: "Educational.",
      lang: "en",
      scheduledPublishTime: NOW + 3600,
      nowUnix: NOW,
    });
    expect(res).toEqual({ postId: "media_x", platform: "ig" });
    expect((graphPost as any).mock.calls).toHaveLength(4);
    expect((graphPost as any).mock.calls[2][1]).toMatchObject({
      media_type: "CAROUSEL",
      children: "c1,c2",
    });
  });

  it("FB: single feed call with attached_media JSON", async () => {
    (graphPost as any)
      .mockResolvedValueOnce({ id: "ph1" }) // pre-upload photo 1
      .mockResolvedValueOnce({ id: "ph2" }) // pre-upload photo 2
      .mockResolvedValueOnce({ id: "fb_post_x" });
    const res = await publishCarouselPost({
      variantId: "var_a",
      platform: "fb",
      imageUrls: ["https://x/1.png", "https://x/2.png"],
      caption: "Educational.",
      lang: "en",
      scheduledPublishTime: NOW + 3600,
      nowUnix: NOW,
    });
    expect(res).toEqual({ postId: "fb_post_x", platform: "fb" });
    expect((graphPost as any).mock.calls[2][0]).toContain("PAGE/feed");
  });

  it("refuses scheduled_publish_time < now + 10min", async () => {
    await expect(
      publishCarouselPost({
        variantId: "var_a",
        platform: "ig",
        imageUrls: ["https://x/1.png"],
        caption: "hi",
        lang: "en",
        scheduledPublishTime: NOW + 100,
        nowUnix: NOW,
      })
    ).rejects.toThrow(/immediate_publish_disabled/);
  });
});
