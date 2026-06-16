import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../graph.js", () => ({ graphPost: vi.fn(), graphGet: vi.fn(), graphDelete: vi.fn() }));
vi.mock("../auth.js", () => ({
  requireEnv: () => ({ pageId: "PAGE", igUserId: "IGU", token: "TKN" }),
}));

import { getPostInsights } from "../tools/get-post-insights.js";
import { graphGet } from "../graph.js";

describe("getPostInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (graphGet as any).mockResolvedValue({ data: [] });
  });

  const IG_METRICS = "reach,views,saved,shares,likes,comments,total_interactions";

  it("requests IG feed metrics when platform=ig and isReel=false", async () => {
    await getPostInsights({ postId: "post_1", platform: "ig", isReel: false });
    const [path, params] = (graphGet as any).mock.calls[0];
    expect(path).toBe("post_1/insights");
    expect(params.metric).toBe(IG_METRICS);
  });

  it("requests IG reel metrics when platform=ig and isReel=true", async () => {
    await getPostInsights({ postId: "post_2", platform: "ig", isReel: true });
    const [path, params] = (graphGet as any).mock.calls[0];
    expect(path).toBe("post_2/insights");
    // Reels share the IG metric set — `views` replaced `plays`.
    expect(params.metric).toBe(IG_METRICS);
  });

  it("requests FB metrics when platform=fb", async () => {
    await getPostInsights({ postId: "post_3", platform: "fb" });
    const [path, params] = (graphGet as any).mock.calls[0];
    expect(path).toBe("post_3/insights");
    expect(params.metric).toBe(
      "post_impressions_unique,post_clicks,post_reactions_like_total"
    );
  });
});
