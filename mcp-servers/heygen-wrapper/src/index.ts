import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateVideo, getVideoStatus, uploadAsset, generateReel } from "./heygen.js";

const server = new McpServer({ name: "heygen", version: "0.1.0" });

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

server.tool(
  "generate_video",
  "Submit a HeyGen render. Returns a jobId for polling. Accepts custom avatar + voice IDs + input text + aspect ratio. Avatar fit defaults per aspect — 9:16 uses fit:'cover' so the 16:9 avatar fills the vertical frame (no letterbox); override fit/scale/offset to tune.",
  {
    avatar_id: z.string(),
    voice_id: z.string(),
    input_text: z.string(),
    language: z.enum(["en", "ms"]),
    aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
    fit: z.enum(["cover", "contain"]).optional(),
    scale: z.number().positive().optional(),
    offset: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
    avatar_style: z.enum(["normal", "closeUp", "circle"]).optional(),
    background_color: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await generateVideo(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_video_status",
  "Poll a previously-submitted HeyGen render. Returns { status, videoUrl?, subtitleUrl?, durationSeconds?, error? }. subtitleUrl and durationSeconds are surfaced when HeyGen's caption_url / duration are present on completion — the Reel pipeline uses them for scene-to-time alignment and caption burn-in.",
  { jobId: z.string() },
  async (args) => {
    try {
      return toolResult(await getVideoStatus(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "upload_asset",
  "Upload a local media file to HeyGen. Returns { assetId, url }. The url is usable directly as a per-scene background.url in generate_reel (used for chart frames).",
  { file_path: z.string(), mime_type: z.string() },
  async (args) => {
    try {
      let bytes: Buffer;
      try {
        bytes = await readFile(args.file_path);
      } catch {
        throw new Error(`upload_asset: file not found at ${args.file_path}`);
      }
      return toolResult(await uploadAsset({ bytes, mimeType: args.mime_type }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "generate_reel",
  "Submit a multi-scene HeyGen reel render in one call. video_inputs is built per scene: kind:'face' = avatar fit:'cover' over a colour bg; kind:'visual' = full-frame image background (chart_url required — any rendered PNG, chart or concept), no avatar. caption defaults true (SRT sidecar). Returns { jobId } for polling via get_video_status.",
  {
    avatar_id: z.string(),
    voice_id: z.string(),
    aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
    scenes: z.array(z.object({
      kind: z.enum(["face", "visual"]),
      voiceover: z.string(),
      chart_url: z.string().optional(),
    })).min(1),
    caption: z.boolean().optional(),
    background_color: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await generateReel(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
