// R2 upload path for asset-store (F11 / E-007 MVP).
//
// When all five R2 env vars are set, every successful local-disk write is
// mirrored to the Cloudflare R2 bucket so the URL returned by asset-store
// (built from ASSET_STORE_PUBLIC_BASE in index.ts) is anonymously fetchable
// by Meta Graph / any external consumer. This is the production path for
// organic IG/FB image+carousel posts whose API requires `image_url`.
//
// When any required env var is missing, R2 is silently disabled — the local
// `file://` URL is returned and meta-organic publishes will fail loudly at
// distribute time. That's intentional: dev machines without R2 creds get the
// degraded-but-obvious behaviour, prod boxes get the full path.
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

export interface R2Config {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Reads env vars at call time (not module-load time) so tests can flip the
 *  config on/off per-case via process.env mutation. */
export function r2ConfigFromEnv(): R2Config | null {
  const bucket = process.env["ASSET_STORE_R2_BUCKET"];
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  if (!bucket || !accountId || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
  };
}

let cachedClient: S3Client | undefined;
let cachedKey: string | undefined;

function getClient(config: R2Config): S3Client {
  // Cache the client across calls; rebuild only if creds rotate at runtime.
  const key = `${config.endpoint}::${config.accessKeyId}`;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    cachedKey = key;
  }
  return cachedClient;
}

/** Test-only: drop the cached client so a fresh one is built next call. */
export function _resetClientForTests(): void {
  cachedClient = undefined;
  cachedKey = undefined;
}

function isNotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/** HeadObject probe — returns true if the key already exists, false on 404.
 *  Any other error (auth, network, throttling) propagates. */
export async function existsInR2(key: string, config: R2Config): Promise<boolean> {
  const client = getClient(config);
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

export interface UploadToR2Args {
  key: string;
  body: Buffer;
  contentType: string;
  config: R2Config;
}

/** PutObject — sets immutable cache headers since asset paths are stable
 *  per (run_id, variant_id, scene_id). Meta's edge caches the first fetch
 *  and never re-pulls the same URL. */
export async function uploadToR2(args: UploadToR2Args): Promise<void> {
  const client = getClient(args.config);
  await client.send(
    new PutObjectCommand({
      Bucket: args.config.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/** End-to-end mirror: skip if already in R2, otherwise upload.
 *  Idempotent — safe to re-run /distribute repeatedly. */
export async function mirrorToR2(args: UploadToR2Args): Promise<{ uploaded: boolean }> {
  if (await existsInR2(args.key, args.config)) {
    return { uploaded: false };
  }
  await uploadToR2(args);
  return { uploaded: true };
}
