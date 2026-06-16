// Asset URLs in creative_variants.asset_files[] are file:// in local dev and
// https:// in prod (R2 with ASSET_STORE_PUBLIC_BASE set). The browser can't
// fetch file://; rewrite to the /api/asset/[runId]/[variantId]/[scene] route
// served by route.ts. This entire helper is dead code once E-007 ships.
const FILE_RE = /^file:\/\/.*\/data\/assets\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/;

export function resolveAssetUrl(url: string): string {
  if (!url.startsWith("file://")) return url;
  const m = url.match(FILE_RE);
  if (!m) return url;
  return `/api/asset/${m[1]}/${m[2]}/${m[3]}`;
}
