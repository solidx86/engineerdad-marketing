// Tests assume `npx playwright install chromium` has been run.
// Browser-dependent tests skip gracefully if Playwright Chromium isn't installed
// (returns a clear error so CI fails loudly rather than silently passing).

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { renderHtmlToPng, shutdownBrowser } from "./render.js";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const HTML_FIXTURE_SIMPLE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { margin: 0; width: 200px; height: 200px; background: #1B2B6B; }
.dot { width: 80px; height: 80px; background: #F07621; margin: 60px; border-radius: 50%; }
</style></head><body><div class="dot"></div></body></html>`;

const HTML_FIXTURE_WITH_CHART_FLAG = `<!doctype html>
<html><head><meta charset="utf-8"><style>body { margin:0; width:200px; height:200px; background:#fff; }</style></head>
<body>
  <div>chart placeholder</div>
  <script>
    setTimeout(() => { window.__chartsReady = true; }, 200);
  </script>
</body></html>`;

const HTML_FIXTURE_NEVER_READY = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <div>no chart-ready signal will fire</div>
</body></html>`;

describe("renderHtmlToPng — input validation (browser-independent)", () => {
  it("rejects path-traversal in run_id", async () => {
    await expect(
      renderHtmlToPng({
        html: "<html></html>",
        width: 100,
        height: 100,
        run_id: "../etc",
        variant_id: "abc123",
        scene_id: 1,
      }),
    ).rejects.toThrow(/run_id must match/);
  });

  it("rejects path-traversal in variant_id", async () => {
    await expect(
      renderHtmlToPng({
        html: "<html></html>",
        width: 100,
        height: 100,
        run_id: "run_test",
        variant_id: "../../escape",
        scene_id: 1,
      }),
    ).rejects.toThrow(/variant_id must match/);
  });

  it("rejects non-positive width", async () => {
    await expect(
      renderHtmlToPng({
        html: "<html></html>",
        width: 0,
        height: 100,
        run_id: "run_test",
        variant_id: "abc123",
        scene_id: 1,
      }),
    ).rejects.toThrow(/width/);
  });

  it("rejects oversize dimensions", async () => {
    await expect(
      renderHtmlToPng({
        html: "<html></html>",
        width: 5000,
        height: 100,
        run_id: "run_test",
        variant_id: "abc123",
        scene_id: 1,
      }),
    ).rejects.toThrow(/width/);
  });

  it("rejects empty html", async () => {
    await expect(
      renderHtmlToPng({
        html: "",
        width: 100,
        height: 100,
        run_id: "run_test",
        variant_id: "abc123",
        scene_id: 1,
      }),
    ).rejects.toThrow(/html/);
  });
});

describe("renderHtmlToPng — Playwright integration", () => {
  let tmp: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "static-renderer-test-"));
    process.env["ASSET_STORE_ROOT"] = tmp;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmp, { recursive: true, force: true });
  });

  afterAll(async () => {
    await shutdownBrowser();
  });

  it("renders simple HTML to a valid PNG with correct dimensions", async () => {
    const result = await renderHtmlToPng({
      html: HTML_FIXTURE_SIMPLE,
      width: 200,
      height: 200,
      run_id: "run_test",
      variant_id: "abc123",
      scene_id: 1,
    });

    expect(result.path).toBe(join(tmp, "run_test", "abc123", "1.png"));
    expect(existsSync(result.path)).toBe(true);
    const buf = readFileSync(result.path);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // PNG width is bytes 16-19 (big-endian), height is 20-23
    expect(buf.readUInt32BE(16)).toBe(200);
    expect(buf.readUInt32BE(20)).toBe(200);
    // sha256 match
    expect(result.sha256).toBe(createHash("sha256").update(buf).digest("hex"));
    expect(result.bytes).toBe(buf.length);
    expect(result.render_ms).toBeGreaterThan(0);
  }, 30_000);

  it("waits for window.__chartsReady when wait_for_charts: true", async () => {
    const result = await renderHtmlToPng({
      html: HTML_FIXTURE_WITH_CHART_FLAG,
      width: 200,
      height: 200,
      run_id: "run_test",
      variant_id: "abc123",
      scene_id: 2,
      wait_for_charts: true,
    });
    expect(existsSync(result.path)).toBe(true);
    // The fixture sets the flag after 200ms — render_ms should reflect that we waited
    expect(result.render_ms).toBeGreaterThanOrEqual(200);
  }, 30_000);

  it("times out (10s) when chart-ready signal never fires", async () => {
    await expect(
      renderHtmlToPng({
        html: HTML_FIXTURE_NEVER_READY,
        width: 200,
        height: 200,
        run_id: "run_test",
        variant_id: "abc123",
        scene_id: 3,
        wait_for_charts: true,
      }),
    ).rejects.toThrow(/timeout|Timeout/);
  }, 15_000);
});
