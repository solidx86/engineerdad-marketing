import { test, expect } from "./fixtures";

test("renders the IG organic queue and marks a post done", async ({ seed, page }) => {
  const runId = "r-organic-1";
  await seed.create("CreativeVariants", {
    title: "Reel · 9:16",
    runId,
    createdBy: "ContentGen",
    organicStatus: "Approved",
    format: "Feed",
    aspect: "9:16",
    assetFiles: [{ url: "https://example.com/1.png", sha256: "deadbeef" }],
    organicLanguage: "en",
    organicCaptionEn: "Saving early compounds. Here's how to start.",
    organicHashtagsIg: ["#parenting", "#savings"],
  });

  await page.goto(`/posting-pack/organic/${runId}`);
  await expect(page.getByText("IG organic posting pack")).toBeVisible();
  await page.getByPlaceholder("IG post ID / URL").first().fill("ig_123");
  await page.getByRole("button", { name: "Mark posted" }).first().click();
  await expect(page.getByText("IG queue empty for this run.")).toBeVisible();
});
