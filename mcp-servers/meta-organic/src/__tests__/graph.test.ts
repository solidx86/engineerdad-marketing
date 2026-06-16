import { describe, expect, it, vi, beforeEach } from "vitest";

// graph.ts resolves its token via auth.getAccessToken (F13). Mock it to a
// fixed Page token so these tests exercise graph.ts alone — the token-exchange
// itself is covered in auth.test.ts.
vi.mock("../auth.js", () => ({ getAccessToken: vi.fn() }));

import { graphPost } from "../graph.js";
import { getAccessToken } from "../auth.js";

describe("graphPost", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getAccessToken).mockResolvedValue("TKN");
  });

  it("posts to /:graph_version/:path with access_token + body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "post_123" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await graphPost("17841/media", { caption: "hi" });
    expect(res).toEqual({ id: "post_123" });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v21\.0\/17841\/media/);
    expect((opts.body as string)).toContain("access_token=TKN");
    expect((opts.body as string)).toContain("caption=hi");
  });

  it("throws on non-2xx with Graph error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid token", code: 190 } }),
    }));
    process.env.META_ORGANIC_ACCESS_TOKEN = "TKN";
    await expect(graphPost("x/y", {})).rejects.toThrow(/Invalid token/);
  });
});
