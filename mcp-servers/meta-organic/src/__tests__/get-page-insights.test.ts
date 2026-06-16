import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../graph.js", () => ({ graphPost: vi.fn(), graphGet: vi.fn(), graphDelete: vi.fn() }));
vi.mock("../auth.js", () => ({
  requireEnv: () => ({ pageId: "PAGE", igUserId: "IGU", token: "TKN" }),
}));

import { getPageInsights } from "../tools/get-page-insights.js";
import { graphGet } from "../graph.js";

describe("getPageInsights", () => {
  const SINCE = 1_700_000_000;
  const UNTIL = 1_700_086_400;

  beforeEach(() => {
    vi.clearAllMocks();
    (graphGet as any).mockResolvedValue({ data: [] });
  });

  it("calls IGU/insights with correct metrics and period for ig platform", async () => {
    await getPageInsights({ platform: "ig", sinceTs: SINCE, untilTs: UNTIL });
    expect(graphGet).toHaveBeenCalledWith("IGU/insights", {
      metric: "follower_count,reach",
      period: "day",
      since: SINCE,
      until: UNTIL,
    });
  });

  it("calls PAGE/insights with correct metrics and period for fb platform", async () => {
    await getPageInsights({ platform: "fb", sinceTs: SINCE, untilTs: UNTIL });
    expect(graphGet).toHaveBeenCalledWith("PAGE/insights", {
      metric: "page_impressions_unique,page_post_engagements,page_follows,page_views_total",
      period: "day",
      since: SINCE,
      until: UNTIL,
    });
  });

  it("omits since/until when not provided", async () => {
    await getPageInsights({ platform: "ig" });
    const [, params] = (graphGet as any).mock.calls[0];
    expect(params.since).toBeUndefined();
    expect(params.until).toBeUndefined();
  });
});
