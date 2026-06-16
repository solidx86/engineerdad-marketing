import { test, expect } from "./fixtures";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("GET /api/asset streams a PNG written to data/assets", async ({ request }) => {
  const dir = resolve(__dirname, "../../../..", "data/assets/run_t1/var_t1");
  mkdirSync(dir, { recursive: true });
  // 1×1 transparent PNG
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000d49444154789c63000100000005000100" +
    "5dcc2bbe0000000049454e44ae426082",
    "hex",
  );
  writeFileSync(resolve(dir, "0.png"), png);

  const res = await request.get("/api/asset/run_t1/var_t1/0.png");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
});

test("GET /api/asset returns 400 for path-traversal attempts", async ({ request }) => {
  const res = await request.get("/api/asset/..%2Fevil/x/y.png");
  expect(res.status()).toBeGreaterThanOrEqual(400);
});
