import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";

const SAFE = /^[a-zA-Z0-9_.-]+$/;

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4",
  ".mov": "video/quicktime", ".webm": "video/webm", ".html": "text/html",
};

function repoRoot(): string {
  let cur = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(cur, "pnpm-workspace.yaml"))) {
    const parent = dirname(cur);
    if (parent === cur) throw new Error("repo root not found");
    cur = parent;
  }
  return cur;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string; variantId: string; scene: string }> },
) {
  const { runId, variantId, scene } = await params;
  for (const v of [runId, variantId, scene]) {
    if (!SAFE.test(v)) return new NextResponse("bad path", { status: 400 });
  }
  const root = process.env.ASSET_STORE_ROOT ?? resolve(repoRoot(), "data/assets");
  const path = resolve(root, runId, variantId, scene);
  if (!path.startsWith(root)) return new NextResponse("bad path", { status: 400 });
  try {
    await stat(path);
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
  const bytes = await readFile(path);
  const mime = MIME[extname(scene).toLowerCase()] ?? "application/octet-stream";
  return new NextResponse(bytes, {
    status: 200,
    headers: { "content-type": mime, "cache-control": "private, max-age=60" },
  });
}
