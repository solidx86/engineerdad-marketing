import { test, expect } from "./fixtures";

test("flipping status to Approved persists and shows in list view", async ({
  seed,
  page,
}) => {
  await seed.create("Briefs", {
    title: "Awaiting Approval Brief",
    runId: "r-status",
    createdBy: "Human",
    angle: "editorial",
    approvalStatus: "Awaiting Approval",
  });

  const { id } = await seed.create("Briefs", {
    title: "Awaiting Approval Brief 2",
    runId: "r-status",
    createdBy: "Human",
    angle: "editorial",
    approvalStatus: "Awaiting Approval",
  });

  await page.goto(`/review/briefs/${id}?mode=edit`);
  await page.locator('select[name="_status"]').selectOption("Approved");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");

  await page.goto("/review/briefs");
  const row = page.getByRole("row").filter({ hasText: "Awaiting Approval Brief 2" });
  await expect(row.getByText("Approved")).toBeVisible();
});
