import { test, expect } from "./fixtures";

test("runs list shows seeded runs with stage + status", async ({ seed, page }) => {
  await seed.orchestratorRun("run_a", "produce", "awaiting_gate");
  await seed.orchestratorRun("run_b", "distribute", "done");
  await page.goto("/runs");
  await expect(page.getByText("run_a")).toBeVisible();
  await expect(page.getByText("run_b")).toBeVisible();
  // Check for the stage column content (in the table, not the filter)
  const row = page.getByRole("row").filter({ hasText: "run_a" });
  await expect(row.getByText("produce")).toBeVisible();
});
