import { test, expect } from "./fixtures";

test("Brief detail renders persona subtitle + body markdown in read mode", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "PRS as Self-Care",
    persona: "engineer_dad_archetype",
    runId: "r-d1",
    createdBy: "Targeting",
    angle: "editorial",
    bodyEn: "# Heading\n\nBody paragraph",
    approvalStatus: "Awaiting Approval",
  });
  await page.goto(`/review/briefs/${id}`);
  await expect(page.getByRole("heading", { name: "PRS as Self-Care" })).toBeVisible();
  await expect(page.getByText("engineer_dad_archetype")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Heading" })).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.locator("form")).toBeVisible();
  await expect(page.locator("textarea[name=\"bodyEn\"]")).toBeVisible();
});

test("Brief detail Approve button transitions status", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "Approve me",
    runId: "r-d2",
    createdBy: "Targeting",
    angle: "editorial",
    approvalStatus: "Awaiting Approval",
  });
  await page.goto(`/review/briefs/${id}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});
