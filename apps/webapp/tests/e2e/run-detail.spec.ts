import { test, expect } from "./fixtures";

test("run detail shows stage timeline + memo + artifacts grouped by Script", async ({ seed, page }) => {
  await seed.orchestratorRun("run_z", "produce", "awaiting_gate");
  const script = await seed.create("Scripts", {
    title: "PRS Self-Care Script",
    runId: "run_z", createdBy: "ContentGen",
    brief: "00000000-0000-0000-0000-000000000000",
  });
  await seed.create("CreativeVariants", {
    title: "Carousel 4:5",
    runId: "run_z", createdBy: "MediaProd",
    script: script.id, format: "Carousel", aspect: "4:5",
    channels: ["Meta-paid"], approvalStatus: "Awaiting Approval", organicStatus: "Draft",
  });
  await seed.create("CreativeVariants", {
    title: "Carousel 1:1",
    runId: "run_z", createdBy: "MediaProd",
    script: script.id, format: "Carousel", aspect: "1:1",
    channels: ["IG-organic"], approvalStatus: "Awaiting Approval", organicStatus: "Draft",
  });
  await seed.create("PerformanceReports", {
    title: "Memo for run_z",
    runId: "run_z", createdBy: "Brain",
    decisionMemoEn: "## Decision\n\nGo with angle A.",
  });
  await page.goto("/runs/run_z");
  await expect(page.getByText("run_z")).toBeVisible();
  await expect(page.getByText("produce", { exact: false })).toBeVisible();
  await expect(page.getByText("HG3", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision", exact: true })).toBeVisible();
  await expect(page.getByText("PRS Self-Care Script")).toBeVisible();
  await expect(page.getByRole("button", { name: "4:5" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1:1" })).toBeVisible();
});

test("run detail debug view shows step table", async ({ seed, page }) => {
  await seed.orchestratorRun("run_dbg", "produce", "awaiting_gate");
  await seed.orchestratorStep("run_dbg", "step_1", "produce", "done");
  await page.goto("/runs/run_dbg?view=debug");
  await expect(page.getByText("step_1")).toBeVisible();
  await expect(page.getByRole("cell", { name: "produce" })).toBeVisible();
});
