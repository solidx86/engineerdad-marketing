// Pure render function — exported separately from MCP wrapper so tests + scripts
// can call it directly without spinning up stdio transport. Mirrors the
// asset-store package's pattern (upload() pure function + MCP wrapper in index.ts).
//
// Concurrency: bounded by an in-process semaphore. Default 6 concurrent pages
// (configurable via RENDERER_MAX_CONCURRENT env). Prevents OOM under parallel
// load — Chromium pages cost ~100MB each; 14 simultaneous pages = 1.4GB peak.
//
// Browser lifecycle: singleton Chromium launched lazily on first call, closed
// on SIGINT / SIGTERM / beforeExit.

import { chromium, type Browser } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

const MAX_CONCURRENT = (() => {
  const raw = process.env["RENDERER_MAX_CONCURRENT"];
  if (!raw) return 6;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
})();

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  // Test-only introspection
  get inflight(): number {
    return this.active;
  }
  get queued(): number {
    return this.queue.length;
  }
}

const semaphore = new Semaphore(MAX_CONCURRENT);

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
    const cleanup = async () => {
      if (browserPromise) {
        try {
          const b = await browserPromise;
          await b.close();
        } catch {
          // ignore — process is exiting
        }
        browserPromise = null;
      }
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    process.once("beforeExit", cleanup);
  }
  return browserPromise;
}

export async function shutdownBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

function findRepoRoot(): string {
  let cur = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(cur, "pnpm-workspace.yaml"))) {
    const parent = dirname(cur);
    if (parent === cur) {
      throw new Error("repo root not found (no pnpm-workspace.yaml in any ancestor)");
    }
    cur = parent;
  }
  return cur;
}

export interface RenderInput {
  html: string;
  width: number;
  height: number;
  run_id: string;
  variant_id: string;
  scene_id: string | number;
  wait_for_charts?: boolean;
}

export interface RenderResult {
  path: string;
  sha256: string;
  bytes: number;
  render_ms: number;
}

export async function renderHtmlToPng(input: RenderInput): Promise<RenderResult> {
  // Validate path segments — same regex as asset-store
  for (const [field, value] of [
    ["run_id", input.run_id],
    ["variant_id", input.variant_id],
  ] as const) {
    if (!SAFE_SEGMENT.test(value)) {
      throw new Error(
        `static-renderer: ${field} must match ${SAFE_SEGMENT} — got ${JSON.stringify(value)}`,
      );
    }
  }
  const sceneSegment = String(input.scene_id);
  if (!SAFE_SEGMENT.test(sceneSegment)) {
    throw new Error(
      `static-renderer: scene_id must match ${SAFE_SEGMENT} — got ${JSON.stringify(input.scene_id)}`,
    );
  }
  if (!Number.isInteger(input.width) || input.width <= 0 || input.width > 4096) {
    throw new Error(`static-renderer: width must be a positive integer ≤ 4096 — got ${input.width}`);
  }
  if (!Number.isInteger(input.height) || input.height <= 0 || input.height > 4096) {
    throw new Error(`static-renderer: height must be a positive integer ≤ 4096 — got ${input.height}`);
  }
  if (!input.html || input.html.trim().length === 0) {
    throw new Error(`static-renderer: html must be a non-empty string`);
  }

  const startedAt = Date.now();
  await semaphore.acquire();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: input.width, height: input.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    try {
      await page.setContent(input.html, { waitUntil: "networkidle", timeout: 15_000 });
      if (input.wait_for_charts) {
        // String predicate runs in browser context (window is defined there);
        // the Node-side TS lib doesn't include DOM, so a function arg would
        // not type-check without casting.
        await page.waitForFunction("window.__chartsReady === true", undefined, {
          timeout: 10_000,
        });
      }
      const buf = await page.screenshot({ type: "png", omitBackground: false });

      const root = process.env["ASSET_STORE_ROOT"] ?? resolve(findRepoRoot(), "data/assets");
      const dir = resolve(root, input.run_id, input.variant_id);
      const filePath = resolve(dir, `${sceneSegment}.png`);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, buf);

      return {
        path: filePath,
        sha256: createHash("sha256").update(buf).digest("hex"),
        bytes: buf.length,
        render_ms: Date.now() - startedAt,
      };
    } finally {
      await context.close();
    }
  } finally {
    semaphore.release();
  }
}

// Test-only export
export const __test = { semaphore, MAX_CONCURRENT };
