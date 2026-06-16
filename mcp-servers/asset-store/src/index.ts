#!/usr/bin/env node
// Local disk + optional R2 mirror (F11 / E-007 MVP).
// Every successful local write under data/assets/<run>/<variant>/<scene>.<ext>
// is mirrored to Cloudflare R2 when all five R2 env vars are set (see r2.ts).
// The `url` field returned is built from ASSET_STORE_PUBLIC_BASE when set
// (typically the R2 custom domain) so downstream consumers — Notion
// AssetFiles, meta-organic publishes, Meta Graph fetches — get a public
// HTTPS URL that Meta's servers can resolve.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile, readFile, copyFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { r2ConfigFromEnv, mirrorToR2 } from "./r2.js";

const server = new McpServer({
  name: "asset-store",
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

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

export interface UploadInput {
  /** Either provide bytes inline... */
  data_base64?: string;
  /** ...or hand off a local file that already exists on disk (typical when
   *  static-renderer just wrote a PNG and you want asset-store to register it). */
  local_path?: string;
  mime_type: string;
  run_id: string;
  variant_id: string;
  scene_id: string | number;
  ext: string;
}

export interface UploadResult {
  /** Canonical local filesystem path under data/assets/<run>/<variant>/<scene>.<ext>. */
  path: string;
  /** URL form. `file://...` today (or HTTP if ASSET_STORE_PUBLIC_BASE is set);
   *  becomes the canonical CDN URL in v1.6 (E-007 R2 swap). This is the field
   *  downstream consumers (Notion AssetFiles, Meta upload_image/upload_video)
   *  should depend on — the local `path` is liable to change. */
  url: string;
  bytes: number;
  sha256: string;
  mime_type: string;
}

function buildPublicUrl(absolutePath: string, root: string): string {
  const base = process.env["ASSET_STORE_PUBLIC_BASE"];
  if (base) {
    // ASSET_STORE_PUBLIC_BASE expected shape: "https://cdn.example.com/assets"
    // We map data/assets/<rest> → <base>/<rest>.
    const trimmed = base.replace(/\/+$/, "");
    const rel = absolutePath.startsWith(root) ? absolutePath.slice(root.length).replace(/^\/+/, "") : absolutePath;
    return `${trimmed}/${rel}`;
  }
  return pathToFileURL(absolutePath).toString();
}

export async function upload(input: UploadInput): Promise<UploadResult> {
  for (const [field, value] of [
    ["run_id", input.run_id],
    ["variant_id", input.variant_id],
    ["ext", input.ext],
  ] as const) {
    if (!SAFE_SEGMENT.test(value)) {
      throw new Error(`asset-store: ${field} must match ${SAFE_SEGMENT} — got ${JSON.stringify(value)}`);
    }
  }
  const sceneSegment = String(input.scene_id);
  if (!SAFE_SEGMENT.test(sceneSegment)) {
    throw new Error(`asset-store: scene_id must match ${SAFE_SEGMENT} — got ${JSON.stringify(input.scene_id)}`);
  }

  const hasB64 = typeof input.data_base64 === "string" && input.data_base64.length > 0;
  const hasLocal = typeof input.local_path === "string" && input.local_path.length > 0;
  if (hasB64 === hasLocal) {
    throw new Error(
      "asset-store: exactly one of data_base64 or local_path must be provided",
    );
  }

  const root = process.env["ASSET_STORE_ROOT"] ?? resolve(findRepoRoot(), "data/assets");
  const dir = resolve(root, input.run_id, input.variant_id);
  const filePath = resolve(dir, `${sceneSegment}.${input.ext}`);

  let buf: Buffer;
  if (hasB64) {
    buf = Buffer.from(input.data_base64!, "base64");
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, buf);
  } else {
    const src = resolve(input.local_path!);
    if (!existsSync(src)) {
      throw new Error(`asset-store: local_path does not exist: ${src}`);
    }
    if (src === filePath) {
      // Source IS the canonical path (typical: static-renderer wrote here directly).
      // Skip the copy; just hash and return.
      buf = await readFile(src);
    } else {
      buf = await readFile(src);
      await mkdir(dir, { recursive: true });
      await copyFile(src, filePath);
    }
  }

  // Verify bytes on disk match the buffer (catches partial writes).
  const onDisk = await stat(filePath);
  if (onDisk.size !== buf.length) {
    throw new Error(
      `asset-store: post-write size mismatch (disk=${onDisk.size}, expected=${buf.length})`,
    );
  }

  // Mirror to R2 when configured. The local write is the source of truth;
  // R2 is the public surface. If R2 is misconfigured or unreachable this
  // throws — we'd rather fail fast than return a URL that Meta can't fetch.
  const r2Config = r2ConfigFromEnv();
  if (r2Config) {
    const key = `${input.run_id}/${input.variant_id}/${sceneSegment}.${input.ext}`;
    await mirrorToR2({ key, body: buf, contentType: input.mime_type, config: r2Config });
  }

  return {
    path: filePath,
    url: buildPublicUrl(filePath, root),
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    mime_type: input.mime_type,
  };
}

server.tool(
  "upload",
  "Register a generated asset under data/assets/<run_id>/<variant_id>/<scene_id>.<ext>. Provide EITHER `data_base64` (raw bytes inline) OR `local_path` (file already on disk — typical right after static-renderer). Returns `path` (canonical local) + `url` (file:// today; HTTPS once ASSET_STORE_PUBLIC_BASE is set or R2 lands per E-007) + sha256 + byte count. Downstream consumers should depend on `url`, not `path`.",
  {
    data_base64: z.string().min(1).optional(),
    local_path: z.string().min(1).optional(),
    mime_type: z.string().min(1),
    run_id: z.string().min(1),
    variant_id: z.string().min(1),
    scene_id: z.union([z.string(), z.number().int()]),
    ext: z.string().min(1),
  },
  async (args) => {
    try {
      return toolResult(await upload(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
