import { describe, it, expect, vi } from "vitest";
vi.mock("@engineerdad/store", () => ({
  store: {
    query: vi.fn(async (entity: string) =>
      entity === "Experiments" ? [{ id: "exp1" }] : [{ id: "row-1" }]),
    get: vi.fn(async (entity: string, id: string) =>
      entity === "Experiments"
        ? { id, cells: [{ cellId: "cell-A", allocationPct: 70, variantPageIds: ["row-1"] }] }
        : {
            id, title: "T1", format: "Feed", aspect: "4:5", channels: ["Meta-paid"],
            assetFiles: [{ url: "https://r2/1.png" }], adId: null,
            metaPrimaryTextEn: "PT", metaHeadlineEn: "H", metaDescriptionEn: "D", metaCtaType: "LEARN_MORE",
            metaPrimaryTextBm: "PTm", metaHeadlineBm: "Hm", metaDescriptionBm: "Dm",
          }),
    update: vi.fn(async () => ({ ok: true })),
  },
}));
import { buildPostingPack, backfillAdId } from "./build-pack.js";

describe("buildPostingPack", () => {
  it("assembles a pack from store rows", async () => {
    const pack = await buildPostingPack("run_1", 10);
    expect(pack.ads).toHaveLength(1);
    expect(pack.ads[0].title).toBe("T1");
    expect(pack.adsets[0].dailyBudgetCents).toBe(700);
  });
  it("backfillAdId writes the adId json", async () => {
    const { store } = await import("@engineerdad/store");
    await backfillAdId("row-1", "111", "222");
    expect(store.update).toHaveBeenCalledWith("CreativeVariants", "row-1", { adId: JSON.stringify({ en: "111", ms: "222" }) });
  });
});
