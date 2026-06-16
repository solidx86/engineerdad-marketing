#!/usr/bin/env node
// Gemini image-generation MCP — Nano Banana / Nano Banana Pro.
// See ADR-013 (docs/decisions/013-multi-modal-media-providers.md).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  generateImage,
  priceForCall,
  type Aspect,
  type GeminiImageModel,
  type Language,
  type Resolution,
} from "./gemini-client.js";
import {
  BudgetExceededError,
  BudgetTracker,
  loadPolicy,
  type Bucket,
} from "./policy.js";

const server = new McpServer({
  name: "media-providers-gemini",
  version: "0.1.0",
});

const toolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const errorResult = (err: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: err instanceof Error ? err.message : String(err),
    },
  ],
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`required env var ${name} is not set`);
  return v;
}

const SUPPORTED_MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"] as const;

interface JobRecord {
  status: "succeeded" | "failed";
  url?: string;
  mimeType?: string;
  costUsd?: number;
  promptHash?: string;
  composedPrompt?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, JobRecord>();
const tracker = new BudgetTracker();

// LRU-style trim: cap in-memory job table at 1000 entries to bound memory.
function trimJobs(): void {
  if (jobs.size <= 1000) return;
  const toEvict = jobs.size - 1000;
  let i = 0;
  for (const key of jobs.keys()) {
    if (i++ >= toEvict) break;
    jobs.delete(key);
  }
}

interface ImageModelInfo {
  id: string;
  modality: "image";
  tier: "fast" | "premium";
  cost_per_image_usd: number;
  supported_aspects: Aspect[];
  capabilities: ("text2image" | "image_edit")[];
}

const STATIC_CATALOG: ImageModelInfo[] = [
  {
    id: "gemini-2.5-flash-image",
    modality: "image",
    tier: "fast",
    cost_per_image_usd: 0.039,
    supported_aspects: ["1:1", "4:5", "9:16", "16:9"],
    capabilities: ["text2image", "image_edit"],
  },
  {
    id: "gemini-3-pro-image-preview",
    modality: "image",
    tier: "premium",
    cost_per_image_usd: 0.134,
    supported_aspects: ["1:1", "4:5", "9:16", "16:9"],
    capabilities: ["text2image", "image_edit"],
  },
];

server.tool(
  "generate_image",
  "Generate a single image via Gemini Nano Banana / Nano Banana Pro. Synchronous in practice — call get_image_status({job_id}) immediately after to retrieve the base64 PNG. Enforces corpus/media-policy.yaml per-bucket allowlist and daily USD cap (in-process; resets on server restart). NO FREE TIER — billing must be enabled on the Google AI project.",
  {
    prompt: z.string().min(1),
    aspect: z.enum(["1:1", "4:5", "9:16", "16:9"]),
    model: z.enum(SUPPORTED_MODELS),
    language: z.enum(["en", "ms"]),
    bucket: z.enum(["70", "20", "10"]),
    resolution: z.enum(["1K", "2K", "4K"]).optional(),
    reference_image_url: z.string().url().optional(),
    style: z.string().optional(),
  },
  async (args) => {
    const jobId = randomUUID();
    try {
      const apiKey = requireEnv("GEMINI_API_KEY");
      const policy = loadPolicy();
      const plannedUsd = priceForCall(args.model as GeminiImageModel, args.resolution as Resolution | undefined);
      tracker.enforceImage({
        bucket: args.bucket as Bucket,
        modelId: args.model,
        plannedUsd,
        policy,
      });

      const styledPrompt = args.style ? `${args.prompt}\n\nStyle: ${args.style}` : args.prompt;

      const result = await generateImage({
        apiKey,
        model: args.model as GeminiImageModel,
        prompt: styledPrompt,
        aspect: args.aspect as Aspect,
        language: args.language as Language,
        resolution: args.resolution as Resolution | undefined,
      });

      tracker.recordSpend(result.costUsd);

      const dataUrl = `data:${result.mimeType};base64,${result.pngBase64}`;
      jobs.set(jobId, {
        status: "succeeded",
        url: dataUrl,
        mimeType: result.mimeType,
        costUsd: result.costUsd,
        promptHash: result.promptHash,
        composedPrompt: result.composedPrompt,
        createdAt: Date.now(),
      });
      trimJobs();

      return toolResult({
        job_id: jobId,
        eta_sec: 0,
        est_cost_usd: result.costUsd,
        // Hint for sync vendors: terminal status is already known.
        status: "succeeded" as const,
        prompt_hash: result.promptHash,
        daily_spent_usd: tracker.getDailyUsd(),
      });
    } catch (err) {
      jobs.set(jobId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        createdAt: Date.now(),
      });
      trimJobs();
      // Surface the error so the calling agent can record + branch.
      const isBudget = err instanceof BudgetExceededError;
      return errorResult(
        new Error(
          `${isBudget ? "[BudgetExceeded] " : ""}${err instanceof Error ? err.message : String(err)} (job_id=${jobId})`,
        ),
      );
    }
  },
);

server.tool(
  "get_image_status",
  "Retrieve the result of a generate_image call. For Gemini's synchronous API the result is already known by the time generate_image returns — this tool exists for interface symmetry with truly-async video vendors (kie.ai). Returns status + url (data: URL with base64 PNG) on success.",
  {
    job_id: z.string().min(1),
  },
  async (args) => {
    const job = jobs.get(args.job_id);
    if (!job) {
      return errorResult(new Error(`gemini: no job with id ${args.job_id}`));
    }
    if (job.status === "failed") {
      return toolResult({
        job_id: args.job_id,
        status: "failed",
        error: job.error,
      });
    }
    return toolResult({
      job_id: args.job_id,
      status: "succeeded",
      url: job.url,
      mime_type: job.mimeType,
      cost_usd: job.costUsd,
      prompt_hash: job.promptHash,
    });
  },
);

server.tool(
  "list_models",
  "List Gemini image-gen models surfaced by this MCP, with modality/tier/pricing/aspects. Pricing as of 2026-05-10 (ADR-013) — verify before changing the lookup table in src/gemini-client.ts.",
  {},
  async () => toolResult({ models: STATIC_CATALOG }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
