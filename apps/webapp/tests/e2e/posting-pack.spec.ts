import { test, expect } from "./fixtures";

test("renders the Meta-paid pack and backfills an ad id", async ({ seed, page }) => {
  const runId = "r-pack-1";
  const variant = await seed.create("CreativeVariants", {
    title: "Feed · 4:5",
    runId,
    createdBy: "ContentGen",
    approvalStatus: "Approved",
    format: "Feed",
    aspect: "4:5",
    channels: ["Meta-paid"],
    assetFiles: [{ url: "https://example.com/a.png", sha256: "deadbeef" }],
    metaPrimaryTextEn: "Learn how to plan for your child's education.",
    metaPrimaryTextBm: "Belajar merancang pendidikan anak anda.",
    metaHeadlineEn: "Plan ahead",
    metaHeadlineBm: "Rancang awal",
    metaDescriptionEn: "Talk to a consultant.",
    metaDescriptionBm: "Hubungi perunding.",
    metaCtaType: "LEARN_MORE",
  });
  await seed.create("Experiments", {
    title: "Pack experiment",
    runId,
    createdBy: "Brain",
    experimentStatus: "active",
    cells: JSON.stringify([
      { cellId: "cell-A", allocationPct: 70, variantPageIds: [variant.id] },
    ]),
  });

  await page.goto(`/posting-pack/${runId}`);
  await expect(page.getByText("Meta-paid posting pack")).toBeVisible();
  await expect(page.getByText("Ad set ·")).toBeVisible();
  await page.getByPlaceholder("EN ad ID").first().fill("111");
  await page.getByPlaceholder("BM ad ID").first().fill("222");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("✓ backfilled")).toBeVisible();
});
