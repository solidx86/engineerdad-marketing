// Loads corpus/media-policy.yaml and enforces:
// 1. Per-bucket model allowlist (allowed_image_models)
// 2. Daily image-gen USD budget (daily_image_gen_budget_usd)
//
// LIMITATION: daily total is tracked in-process. Process restart resets the
// counter. Cross-process tracking via the analytics events table is deferred to
// TASKS.md E-007 (R2 backend swap brings durable cost ledger with it).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";

export type Bucket = "70" | "20" | "10";

export interface MediaPolicy {
  daily_video_gen_budget_usd: number;
  daily_image_gen_budget_usd: number;
  buckets: Record<
    Bucket,
    {
      allowed_video_tiers: string[];
      allowed_image_models: string[];
      max_clips_per_run: number;
      max_images_per_run: number;
    }
  >;
  fallback_on_failure: string;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
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

let cachedPolicy: MediaPolicy | null = null;
let cachedPath: string | null = null;

export function loadPolicy(overridePath?: string): MediaPolicy {
  const path = overridePath ?? resolve(findRepoRoot(), "corpus/media-policy.yaml");
  if (cachedPolicy && cachedPath === path) return cachedPolicy;
  if (!existsSync(path)) {
    throw new Error(`media-policy: ${path} not found`);
  }
  const raw = readFileSync(path, "utf8");
  const parsed = loadYaml(raw) as MediaPolicy;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`media-policy: failed to parse ${path}`);
  }
  cachedPolicy = parsed;
  cachedPath = path;
  return parsed;
}

export function clearPolicyCache(): void {
  cachedPolicy = null;
  cachedPath = null;
}

export class BudgetTracker {
  private dailyUsd = 0;
  private dayStartedAt = this.startOfTodayUtc();

  private startOfTodayUtc(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  private rollIfNewDay(): void {
    const today = this.startOfTodayUtc();
    if (today !== this.dayStartedAt) {
      this.dayStartedAt = today;
      this.dailyUsd = 0;
    }
  }

  enforceImage(opts: {
    bucket: Bucket;
    modelId: string;
    plannedUsd: number;
    policy: MediaPolicy;
  }): void {
    this.rollIfNewDay();
    const bucketConfig = opts.policy.buckets[opts.bucket];
    if (!bucketConfig) {
      throw new BudgetExceededError(
        `media-policy: unknown bucket "${opts.bucket}" — must be one of 70|20|10`,
      );
    }
    if (!bucketConfig.allowed_image_models.includes(opts.modelId)) {
      throw new BudgetExceededError(
        `media-policy: model "${opts.modelId}" not allowed for bucket "${opts.bucket}". ` +
          `Allowed: ${bucketConfig.allowed_image_models.join(", ")}`,
      );
    }
    if (this.dailyUsd + opts.plannedUsd > opts.policy.daily_image_gen_budget_usd) {
      throw new BudgetExceededError(
        `media-policy: daily image-gen budget would be exceeded. ` +
          `Used $${this.dailyUsd.toFixed(3)} + planned $${opts.plannedUsd.toFixed(3)} > ` +
          `cap $${opts.policy.daily_image_gen_budget_usd.toFixed(2)}`,
      );
    }
  }

  recordSpend(usd: number): void {
    this.rollIfNewDay();
    this.dailyUsd += usd;
  }

  /** Visible for tests + observability. */
  getDailyUsd(): number {
    this.rollIfNewDay();
    return this.dailyUsd;
  }
}
