import { test, expect } from "./fixtures";

test("list view renders seeded Briefs", async ({ seed, page }) => {
  await seed.create("Briefs", {
    title: "Education Fund Math",
    runId: "r-list-1",
    createdBy: "Human",
    angle: "editorial",
    persona: "young_parents_25_35",
  });
  await seed.create("Briefs", {
    title: "PRS Tax Relief",
    runId: "r-list-1",
    createdBy: "Human",
    angle: "editorial",
    persona: "established_parents_35_45",
  });

  await page.goto("/review/briefs");
  await expect(page.getByText("Education Fund Math")).toBeVisible();
  await expect(page.getByText("PRS Tax Relief")).toBeVisible();
});

test("list view shows 'no rows' when empty", async ({ seed: _seed, page }) => {
  await page.goto("/review/briefs");
  await expect(page.getByText("no rows")).toBeVisible();
});
