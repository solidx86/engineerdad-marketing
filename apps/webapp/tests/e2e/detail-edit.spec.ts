import { test, expect } from "./fixtures";

test("editing a field and saving persists to the store", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "Original Title",
    runId: "r-edit",
    createdBy: "Human",
    angle: "editorial",
    promise: "Original promise",
  });

  await page.goto(`/review/briefs/${id}?mode=edit`);
  await expect(page.getByText("Original Title")).toBeVisible();

  const promiseField = page.locator('[name="promise"]');
  await promiseField.fill("Edited promise");
  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.locator('[name="promise"]')).toHaveValue("Edited promise");
});
