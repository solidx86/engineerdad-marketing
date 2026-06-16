import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../graph.js", () => ({ graphPost: vi.fn(), graphGet: vi.fn(), graphDelete: vi.fn() }));
vi.mock("../auth.js", () => ({
  requireEnv: () => ({ pageId: "PAGE", igUserId: "IGU", token: "TKN" }),
}));

import { cancelScheduledPost } from "../tools/cancel-scheduled-post.js";
import { graphDelete } from "../graph.js";

describe("cancelScheduledPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (graphDelete as any).mockResolvedValue({ success: true });
  });

  it("calls graphDelete with the postId", async () => {
    await cancelScheduledPost({ postId: "sched_post_1" });
    expect(graphDelete).toHaveBeenCalledWith("sched_post_1");
  });

  it("returns the graphDelete response", async () => {
    const result = await cancelScheduledPost({ postId: "sched_post_2" });
    expect(result).toEqual({ success: true });
  });
});
