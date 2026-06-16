#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  uploadVideo,
  getVideoStatus,
  updateVideoMetadata,
  uploadThumbnail,
  deleteVideo,
} from "./videos.js";

const server = new McpServer({
  name: "youtube",
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

// ════════════════════════════════════════════════════════════════════════════
// SAFETY DOCTRINE (ADR-015 applied to YouTube):
//   - upload_video hard-wires privacyStatus='unlisted' in the handler. No
//     `privacy_status` field exists in the input schema. Activation to
//     'public' is a human step in YouTube Studio.
//   - No `set_public`, `update_privacy_status`, or any equivalent.
//   - update_video_metadata refuses public videos (human-territory).
//   - delete_video is allowed (cleanup direction).
// ════════════════════════════════════════════════════════════════════════════

server.tool(
  "upload_video",
  "Upload a video to YouTube in UNLISTED state. The video always lands unlisted — there is no `privacy_status` field in this schema. Activation to 'public' is a human-only action in YouTube Studio (ADR-015 applied to YouTube). Reads bytes from `local_path` and posts via multipart (no URL-fetch mode — YouTube's API doesn't support one). Defaults: categoryId=27 (Education), made_for_kids=false, embeddable=true.",
  {
    local_path: z.string().min(1),
    title: z.string().min(1).max(100),
    description: z.string().max(5000).optional(),
    tags: z.array(z.string().min(1)).max(500).optional(),
    category_id: z.string().optional(),
    default_language: z.enum(["en", "ms"]).optional(),
    mime_type: z.string().optional(),
    made_for_kids: z.boolean().optional(),
  },
  async (args) => {
    try {
      return toolResult(await uploadVideo(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_video_status",
  "Read snippet, status, processing details, and duration for a video. Read-only. Useful for polling after upload (uploadStatus → 'processed') or for detecting public-state regressions.",
  { video_id: z.string().min(1) },
  async (args) => {
    try {
      return toolResult(await getVideoStatus(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "update_video_metadata",
  "Edit title / description / tags / category / default_language on a video. REFUSED if the video is `public` — public-video edits are human territory in YouTube Studio. Always allowed on unlisted / private videos. videos.update is a PUT (not PATCH), so the handler reads current state and merges in only the fields you supply.",
  {
    video_id: z.string().min(1),
    title: z.string().min(1).max(100).optional(),
    description: z.string().max(5000).optional(),
    tags: z.array(z.string().min(1)).max(500).optional(),
    category_id: z.string().optional(),
    default_language: z.enum(["en", "ms"]).optional(),
  },
  async (args) => {
    try {
      return toolResult(await updateVideoMetadata(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "upload_thumbnail",
  "Replace the thumbnail of a video. Reads PNG/JPG bytes from `local_path` and posts via multipart. Returns the default-resolution thumbnail URL after replace.",
  {
    video_id: z.string().min(1),
    local_path: z.string().min(1),
    mime_type: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await uploadThumbnail(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "delete_video",
  "Permanently delete a video. Cleanup direction — always allowed regardless of privacy state.",
  { video_id: z.string().min(1) },
  async (args) => {
    try {
      return toolResult(await deleteVideo(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
