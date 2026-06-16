#!/usr/bin/env node
// SKELETON — interface declared so v1.6 video PR is purely additive (replace
// handler bodies; scaffolding stays as-is). list_models() returns the static
// catalog so consumers can see what's planned even though generate_clip /
// get_clip_status throw NotImplemented.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "media-providers-kie-ai",
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

const NOT_IMPLEMENTED =
  "kie.ai video generation not yet implemented — see TASKS.md E-004 video phase. " +
  "Skeleton tools exist for interface validation only. Real impl ships when E-004 is picked up.";

interface KieAiModelInfo {
  id: string;
  modality: "video";
  tier: "fast" | "premium";
  cost_per_sec_usd: number;
  max_duration_sec: number;
  supported_aspects: string[];
  capabilities: ("text2video" | "image2video" | "lipsync" | "i2v_with_audio")[];
}

const STATIC_CATALOG: KieAiModelInfo[] = [
  {
    id: "veo-3-fast",
    modality: "video",
    tier: "fast",
    cost_per_sec_usd: 0.05,
    max_duration_sec: 8,
    supported_aspects: ["9:16", "1:1", "16:9"],
    capabilities: ["text2video"],
  },
  {
    id: "veo-3",
    modality: "video",
    tier: "premium",
    cost_per_sec_usd: 0.5,
    max_duration_sec: 8,
    supported_aspects: ["9:16", "1:1", "16:9"],
    capabilities: ["text2video", "image2video"],
  },
  {
    id: "kling-2.0",
    modality: "video",
    tier: "fast",
    cost_per_sec_usd: 0.1,
    max_duration_sec: 10,
    supported_aspects: ["9:16", "1:1", "16:9"],
    capabilities: ["text2video", "image2video"],
  },
  {
    id: "runway-gen3",
    modality: "video",
    tier: "premium",
    cost_per_sec_usd: 0.4,
    max_duration_sec: 10,
    supported_aspects: ["9:16", "1:1", "16:9"],
    capabilities: ["text2video", "image2video"],
  },
  {
    id: "hailuo-i2v",
    modality: "video",
    tier: "fast",
    cost_per_sec_usd: 0.08,
    max_duration_sec: 6,
    supported_aspects: ["9:16", "16:9"],
    capabilities: ["image2video"],
  },
  {
    id: "sora-1",
    modality: "video",
    tier: "premium",
    cost_per_sec_usd: 0.45,
    max_duration_sec: 20,
    supported_aspects: ["9:16", "1:1", "16:9"],
    capabilities: ["text2video", "i2v_with_audio"],
  },
];

server.tool(
  "generate_clip",
  "SKELETON — kie.ai video generation; throws NotImplemented. Real impl ships in TASKS.md E-004 video phase.",
  {
    prompt: z.string().min(1),
    duration_sec: z.number().int().positive(),
    aspect: z.enum(["9:16", "1:1", "16:9", "4:5"]),
    reference_image_url: z.string().url().optional(),
    style: z.string().optional(),
    model: z.string().min(1),
    language: z.enum(["en", "ms"]).optional(),
    voiceover: z
      .object({
        script: z.string(),
        voice_id: z.string().optional(),
      })
      .optional(),
  },
  async () => errorResult(new Error(NOT_IMPLEMENTED)),
);

server.tool(
  "get_clip_status",
  "SKELETON — kie.ai job poller; throws NotImplemented.",
  {
    job_id: z.string().min(1),
  },
  async () => errorResult(new Error(NOT_IMPLEMENTED)),
);

server.tool(
  "list_models",
  "Returns the static catalog of video models kie.ai will surface. Available now (returns the catalog) even though generate_clip / get_clip_status are not yet implemented — this lets consumers preview the v1.6 surface.",
  {},
  async () => toolResult({ models: STATIC_CATALOG }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
