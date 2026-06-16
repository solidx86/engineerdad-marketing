import { test, expect } from "./fixtures";

test("CreativeVariants list shows channels column + filters by channel", async ({ seed, page }) => {
  await seed.create("CreativeVariants", {
    title: "Carousel A",
    runId: "r-list-cv",
    createdBy: "MediaProd",
    channels: ["Meta-paid", "IG-organic"],
    approvalStatus: "Awaiting Approval",
    organicStatus: "Draft",
  });
  await seed.create("CreativeVariants", {
    title: "Reel B",
    runId: "r-list-cv",
    createdBy: "MediaProd",
    channels: ["YT"],
    approvalStatus: "Approved",
    organicStatus: "Approved",
  });
  await page.goto("/review/creative-variants");
  await expect(page.getByText("Carousel A")).toBeVisible();
  await expect(page.getByText("Reel B")).toBeVisible();
  await expect(page.getByText("Meta-paid")).toBeVisible();
  await page.goto("/review/creative-variants?channels=YT");
  await expect(page.getByText("Reel B")).toBeVisible();
  await expect(page.getByText("Carousel A")).toHaveCount(0);
});
