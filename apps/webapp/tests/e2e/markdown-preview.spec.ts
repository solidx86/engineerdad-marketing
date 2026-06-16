import { test, expect } from "./fixtures";

test("markdown body field renders a live side-by-side preview", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "Markdown Test",
    runId: "r-md",
    createdBy: "Human",
    angle: "editorial",
    bodyEn: "# Heading\n\nA paragraph with **bold**.",
  });

  await page.goto(`/review/briefs/${id}?mode=edit`);

  await expect(page.locator('textarea[name="bodyEn"]')).toHaveValue(
    "# Heading\n\nA paragraph with **bold**.",
  );

  const preview = page.locator(".prose").first();
  await expect(preview.locator("h1")).toHaveText("Heading");
  await expect(preview.locator("strong")).toHaveText("bold");

  await page.locator('textarea[name="bodyEn"]').fill("## Smaller heading");
  await expect(preview.locator("h2")).toHaveText("Smaller heading");
});
