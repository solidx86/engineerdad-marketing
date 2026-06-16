import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BudgetExceededError,
  BudgetTracker,
  clearPolicyCache,
  loadPolicy,
  type MediaPolicy,
} from "./policy.js";
import { composePrompt, priceForCall, sha256Hex } from "./gemini-client.js";

describe("gemini-client pricing", () => {
  it("returns the standard-tier price for Nano Banana", () => {
    expect(priceForCall("gemini-2.5-flash-image")).toBe(0.039);
  });

  it("returns 1K price for Nano Banana Pro by default", () => {
    expect(priceForCall("gemini-3-pro-image-preview")).toBe(0.134);
  });

  it("returns 4K price for Nano Banana Pro at 4K", () => {
    expect(priceForCall("gemini-3-pro-image-preview", "4K")).toBe(0.24);
  });
});

describe("composePrompt", () => {
  it("embeds aspect and language hints into the prompt body", () => {
    const out = composePrompt({
      prompt: "a friendly cat",
      aspect: "1:1",
      language: "en",
    });
    expect(out).toContain("a friendly cat");
    expect(out).toContain("1:1 aspect-ratio");
    expect(out).toContain("English");
  });

  it("uses Bahasa Malaysia label for ms", () => {
    const out = composePrompt({
      prompt: "cat",
      aspect: "9:16",
      language: "ms",
    });
    expect(out).toContain("Bahasa Malaysia");
  });
});

describe("sha256Hex", () => {
  it("produces a stable 64-char hex digest", () => {
    const h = sha256Hex("hello");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(sha256Hex("hello"));
  });
});

describe("loadPolicy", () => {
  let tmp: string;
  let policyPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "media-policy-test-"));
    policyPath = join(tmp, "media-policy.yaml");
    writeFileSync(
      policyPath,
      `daily_video_gen_budget_usd: 50
daily_image_gen_budget_usd: 10
buckets:
  "70":
    allowed_video_tiers: [premium, fast]
    allowed_image_models: [gemini-3-pro-image-preview, gemini-2.5-flash-image]
    max_clips_per_run: 20
    max_images_per_run: 60
  "20":
    allowed_video_tiers: [fast]
    allowed_image_models: [gemini-2.5-flash-image]
    max_clips_per_run: 30
    max_images_per_run: 90
  "10":
    allowed_video_tiers: [free, fast]
    allowed_image_models: [gemini-2.5-flash-image]
    max_clips_per_run: 10
    max_images_per_run: 30
fallback_on_failure: stock-footage
`,
    );
    clearPolicyCache();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    clearPolicyCache();
  });

  it("parses a valid media-policy.yaml", () => {
    const policy = loadPolicy(policyPath);
    expect(policy.daily_image_gen_budget_usd).toBe(10);
    expect(policy.buckets["70"].allowed_image_models).toEqual([
      "gemini-3-pro-image-preview",
      "gemini-2.5-flash-image",
    ]);
  });

  it("throws on missing file", () => {
    expect(() => loadPolicy(join(tmp, "missing.yaml"))).toThrow(/not found/);
  });
});

describe("BudgetTracker.enforceImage", () => {
  let policy: MediaPolicy;

  beforeEach(() => {
    policy = {
      daily_video_gen_budget_usd: 50,
      daily_image_gen_budget_usd: 0.5,
      buckets: {
        "70": {
          allowed_video_tiers: ["premium"],
          allowed_image_models: ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"],
          max_clips_per_run: 20,
          max_images_per_run: 60,
        },
        "20": {
          allowed_video_tiers: ["fast"],
          allowed_image_models: ["gemini-2.5-flash-image"],
          max_clips_per_run: 30,
          max_images_per_run: 90,
        },
        "10": {
          allowed_video_tiers: ["free"],
          allowed_image_models: ["gemini-2.5-flash-image"],
          max_clips_per_run: 10,
          max_images_per_run: 30,
        },
      },
      fallback_on_failure: "stock-footage",
    };
  });

  it("permits an allowed model under budget", () => {
    const t = new BudgetTracker();
    expect(() =>
      t.enforceImage({
        bucket: "70",
        modelId: "gemini-2.5-flash-image",
        plannedUsd: 0.039,
        policy,
      }),
    ).not.toThrow();
  });

  it("rejects a model not in the bucket allowlist", () => {
    const t = new BudgetTracker();
    expect(() =>
      t.enforceImage({
        bucket: "20",
        modelId: "gemini-3-pro-image-preview",
        plannedUsd: 0.134,
        policy,
      }),
    ).toThrow(BudgetExceededError);
  });

  it("rejects when daily cap would be exceeded", () => {
    const t = new BudgetTracker();
    t.recordSpend(0.48);
    expect(() =>
      t.enforceImage({
        bucket: "70",
        modelId: "gemini-2.5-flash-image",
        plannedUsd: 0.039,
        policy,
      }),
    ).toThrow(BudgetExceededError);
  });

  it("rejects unknown bucket", () => {
    const t = new BudgetTracker();
    expect(() =>
      t.enforceImage({
        bucket: "99" as unknown as "70",
        modelId: "gemini-2.5-flash-image",
        plannedUsd: 0.039,
        policy,
      }),
    ).toThrow(/unknown bucket/);
  });
});
