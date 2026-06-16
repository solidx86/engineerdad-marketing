#!/usr/bin/env node
// One-off backfill: re-upload locally rendered PNGs to R2 and patch
// CreativeVariants.asset_files[].url so the IG posting pack (and any
// other downstream consumer that browser-loads the URL) can fetch them.
//
// Background: before 0ef608a, the asset-store + static-renderer MCPs
// did not load .env / .env.local, so ASSET_STORE_PUBLIC_BASE was never
// in their env and asset-store fell back to file:// URLs. Those URLs
// got persisted on every variant rendered before the fix. This script
// walks all variants for a runId, uploads the corresponding local PNGs
// to R2 (under the same key the asset-store MCP would have used), and
// rewrites the URLs in place.
//
// Usage:  node scripts/backfill-asset-urls.mjs <runId>
// Throwaway — delete once asset-store has been re-released and any
// stale runs are out of scope.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

function findRepoRoot() {
  let cur = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(cur, "pnpm-workspace.yaml"))) {
    const parent = dirname(cur);
    if (parent === cur) throw new Error("repo root not found");
    cur = parent;
  }
  return cur;
}
const repoRoot = findRepoRoot();

function loadEnvFile(path, { override }) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (override || !(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(resolve(repoRoot, ".env"), { override: false });
loadEnvFile(resolve(repoRoot, ".env.local"), { override: true });

for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "ASSET_STORE_R2_BUCKET", "ASSET_STORE_PUBLIC_BASE", "DATABASE_URL"]) {
  if (!process.env[k]) {
    console.error(`ERROR: ${k} missing from .env / .env.local`);
    process.exit(1);
  }
}

const runId = process.argv[2];
if (!runId) {
  console.error("usage: node scripts/backfill-asset-urls.mjs <runId>");
  process.exit(1);
}

const storeBarrel = `file://${resolve(repoRoot, "packages/store/dist/index.js")}`;
const { store } = await import(storeBarrel);

const requireFromAssetStore = createRequire(resolve(repoRoot, "mcp-servers/asset-store/package.json"));
const { S3Client, PutObjectCommand } = requireFromAssetStore("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.ASSET_STORE_R2_BUCKET;
const publicBase = process.env.ASSET_STORE_PUBLIC_BASE.replace(/\/+$/, "");

const ids = await store.query("CreativeVariants", { runId });
let touchedVariants = 0;
let uploaded = 0;
let skipped = 0;

for (const ref of ids) {
  const row = await store.get("CreativeVariants", ref.id);
  if (!Array.isArray(row.assetFiles) || row.assetFiles.length === 0) continue;
  let mutated = false;
  const updated = [];
  for (const af of row.assetFiles) {
    if (!af?.url || !af.url.startsWith("file://")) {
      updated.push(af);
      continue;
    }
    const localPath = fileURLToPath(af.url);
    if (!existsSync(localPath)) {
      console.warn(`  skip — missing local file: ${localPath}`);
      updated.push(af);
      skipped++;
      continue;
    }
    const data = readFileSync(localPath);
    const sha256 = createHash("sha256").update(data).digest("hex");
    // R2 object key = the path under data/assets/ — same shape the asset-store MCP would have used.
    const assetsRoot = resolve(repoRoot, "data/assets");
    const objectKey = localPath.startsWith(assetsRoot)
      ? localPath.slice(assetsRoot.length).replace(/^\/+/, "")
      : localPath.replace(/^\/+/, "");
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: data,
        ContentType: "image/png",
      }),
    );
    const newUrl = `${publicBase}/${objectKey}`;
    updated.push({ url: newUrl, sha256 });
    console.log(`  uploaded ${objectKey} → ${newUrl}`);
    uploaded++;
    mutated = true;
  }
  if (mutated) {
    await store.update("CreativeVariants", row.id, { assetFiles: updated });
    touchedVariants++;
  }
}

console.log(`\n  ${touchedVariants} variant(s) updated, ${uploaded} png(s) uploaded, ${skipped} skipped`);
