import { test, expect } from "./fixtures";

test("Distributions list shows tailored columns + filters", async ({ seed, page }) => {
  const runId = "r-dist-1";
  const targetId = "00000000-0000-0000-0000-000000000001";

  await seed.create("Distributions", {
    title: "Meta-paid route attempt #1",
    runId,
    createdBy: "Distributor",
    targetEntity: "CreativeVariants",
    targetId,
    channel: "Meta-paid",
    status: "routed",
    authorStep: "D2b-route",
    attempt: 1,
    dryRun: false,
  });
  await seed.create("Distributions", {
    title: "YouTube route attempt #1",
    runId,
    createdBy: "Distributor",
    targetEntity: "CreativeVariants",
    targetId,
    channel: "YouTube",
    status: "failed",
    authorStep: "D2b-route",
    attempt: 1,
    dryRun: false,
  });
  await seed.create("Distributions", {
    title: "Article confirm",
    runId,
    createdBy: "Distributor",
    targetEntity: "AuthorityArticles",
    targetId,
    channel: "Article",
    status: "dry-run",
    authorStep: "D3-confirm",
    attempt: 1,
    dryRun: true,
  });

  await page.goto(`/review/distributions?runId=${runId}`);

  // Heading + row count
  await expect(page.getByRole("heading", { name: /^Distributions/ })).toBeVisible();
  await expect(page.getByText("(3)")).toBeVisible();

  // Tailored columns are present
  await expect(page.getByRole("columnheader", { name: /When/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Channel/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Target/ }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Status/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^Step/ })).toBeVisible();

  // Filter dropdowns expose enum options — option elements are DOM-attached but
  // not "visible" (browsers hide them when the select is closed), so toBeAttached.
  await expect(page.locator("option", { hasText: "Meta-paid" }).first()).toBeAttached();
  await expect(page.locator("option", { hasText: "YouTube" }).first()).toBeAttached();
  await expect(page.locator("option", { hasText: "routed" }).first()).toBeAttached();
  await expect(page.locator("option", { hasText: "failed" }).first()).toBeAttached();
  await expect(page.locator("option", { hasText: "D2b-route" }).first()).toBeAttached();

  // Filter by channel narrows the list
  await page.goto(`/review/distributions?runId=${runId}&channel=YouTube`);
  await expect(page.getByText("(1)")).toBeVisible();
});
