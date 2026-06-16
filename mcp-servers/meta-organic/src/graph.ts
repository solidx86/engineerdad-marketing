import { getAccessToken } from "./auth.js";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export async function graphPost(path: string, body: Record<string, unknown>): Promise<any> {
  const token = await getAccessToken();
  const params = new URLSearchParams();
  params.set("access_token", token);
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    params.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = (await res.json()) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(`Graph error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return json;
}

export async function graphGet(path: string, params: Record<string, unknown> = {}): Promise<any> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs.toString()}`);
  const json = (await res.json()) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(`Graph error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return json;
}

/** Reels upload phase (B-009). POSTs to the `upload_url` returned by the
 *  video_reels `start` phase — that URL is on `rupload.facebook.com`, not the
 *  Graph host, and uses OAuth header auth. Uses the hosted-URL option
 *  (`file_url` header) so Meta fetches the video itself rather than us
 *  streaming bytes. Hence its own helper, separate from graphPost. */
export async function reelsUpload(uploadUrl: string, fileUrl: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      file_url: fileUrl,
    },
  });
  const json = (await res.json()) as { error?: { message?: string } } & Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(`Reels upload error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return json;
}

export async function graphDelete(path: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}/${path}?access_token=${encodeURIComponent(token)}`, {
    method: "DELETE",
  });
  const json = (await res.json()) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(`Graph error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return json;
}
