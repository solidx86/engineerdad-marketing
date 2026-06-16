#!/usr/bin/env node
// MCP wrapper around the pure renderHtmlToPng function in render.ts.
// Single tool: render_html_to_png.
//
// Renders worker-authored HTML to PNG via headless Chromium (Playwright),
// writes to data/assets/<run_id>/<variant_id>/<scene_id>.png. Bounded
// concurrency pool (default 6) prevents OOM under parallel /produce loads.
// Forward-compatible with R2 storage swap (E-007 #2) — only the writeFile
// call body changes; interface preserved.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { renderHtmlToPng } from "./render.js";

const server = new McpServer({
  name: "static-renderer",
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

server.tool(
  "render_html_to_png",
  "Render a self-contained HTML document to a PNG via headless Chromium (Playwright). Writes the PNG to data/assets/<run_id>/<variant_id>/<scene_id>.png and returns {path, sha256, bytes, render_ms}. Pass wait_for_charts: true when the HTML embeds Chart.js — the renderer will wait for window.__chartsReady === true (10s timeout) before screenshotting. Bounded concurrency pool (default 6, override via RENDERER_MAX_CONCURRENT env).",
  {
    html: z.string().min(1).describe("Full self-contained HTML document (inline CSS/JS only, no external file refs except Google Fonts CDN)"),
    width: z.number().int().positive().max(4096).describe("Viewport width in px (typically 1080)"),
    height: z.number().int().positive().max(4096).describe("Viewport height in px (1080 for 1:1, 1350 for 4:5)"),
    run_id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/).describe("Run ID — used as path segment"),
    variant_id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/).describe("Stable Variant ID per G5 formula sha256(scriptId|format|aspect).slice(0,12)"),
    scene_id: z.union([z.string().regex(/^[a-zA-Z0-9_-]+$/), z.number().int()]).describe("Scene/card index (1-indexed)"),
    wait_for_charts: z.boolean().optional().describe("If true, wait for window.__chartsReady === true before screenshot (10s timeout)"),
  },
  async (args) => {
    try {
      return toolResult(await renderHtmlToPng(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
