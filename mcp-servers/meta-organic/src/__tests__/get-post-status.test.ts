import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../graph.js", () => ({ graphPost: vi.fn(), graphGet: vi.fn(), graphDelete: vi.fn() }));
vi.mock("../auth.js", () => ({
  requireEnv: () => ({ pageId: "PAGE", igUserId: "IGU", token: "TKN" }),
}));

import { getPostStatus } from "../tools/get-post-status.js";
import { graphGet } from "../graph.js";

describe("getPostStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (graphGet as any).mockResolvedValue({ id: "post_1" });
  });

  it("requests IG-specific fields for ig platform", async () => {
    await getPostStatus({ postId: "post_1", platform: "ig" });
    expect(graphGet).toHaveBeenCalledWith("post_1", {
      fields: "id,status,scheduled_publish_time,permalink",
    });
  });

  it("requests FB-specific fields for fb platform", async () => {
    await getPostStatus({ postId: "post_2", platform: "fb" });
    expect(graphGet).toHaveBeenCalledWith("post_2", {
      fields: "id,is_published,scheduled_publish_time,permalink_url",
    });
  });
});
