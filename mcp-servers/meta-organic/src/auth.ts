const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export function requireEnv() {
  const pageId = process.env.META_ORGANIC_PAGE_ID;
  const igUserId = process.env.META_ORGANIC_IG_USER_ID;
  const token = process.env.META_ORGANIC_ACCESS_TOKEN;
  if (!pageId) throw new Error("META_ORGANIC_PAGE_ID not set");
  if (!igUserId) throw new Error("META_ORGANIC_IG_USER_ID not set");
  if (!token) throw new Error("META_ORGANIC_ACCESS_TOKEN not set");
  return { pageId, igUserId, token };
}

// ── F13 — Page-token auto-exchange ──────────────────────────────────────────
// FB Page posts must be made with a *Page* access token: a User token yields
// "(#200) Unpublished posts must be posted to a page as the page itself". The
// operator should not have to hand-swap tokens in .env. `GET /{pageId}?fields=
// access_token` returns the Page token whether the caller passed a User token
// (with pages_* permissions) or already a Page token — so this exchange is
// idempotent and safe to run unconditionally. Resolved once, lazily, on the
// first Graph call, then cached for the life of the process. On any failure it
// falls back to the configured token as-is so a misconfigured exchange degrades
// to the prior (manual-swap) behaviour rather than hard-failing the server.

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

async function resolvePageToken(): Promise<string> {
  const configured = process.env.META_ORGANIC_ACCESS_TOKEN;
  if (!configured) throw new Error("META_ORGANIC_ACCESS_TOKEN not set");
  const pageId = process.env.META_ORGANIC_PAGE_ID;
  if (!pageId) return configured; // nothing to resolve against

  try {
    const url =
      `${GRAPH_BASE}/${pageId}?fields=access_token` +
      `&access_token=${encodeURIComponent(configured)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      access_token?: string;
      error?: { message?: string };
    };
    if (res.ok && !json.error && json.access_token) {
      return json.access_token;
    }
    console.error(
      `[meta-organic] Page-token auto-exchange failed ` +
        `(${json.error?.message ?? `HTTP ${res.status}`}); ` +
        `using META_ORGANIC_ACCESS_TOKEN as-is.`
    );
    return configured;
  } catch (err) {
    console.error(
      `[meta-organic] Page-token auto-exchange threw ` +
        `(${err instanceof Error ? err.message : String(err)}); ` +
        `using META_ORGANIC_ACCESS_TOKEN as-is.`
    );
    return configured;
  }
}

/** Resolve (once, cached) the Page access token used for every Graph call.
 *  See the F13 note above — auto-exchanges a User token for the Page token. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (!inflight) inflight = resolvePageToken();
  try {
    cachedToken = await inflight;
    return cachedToken;
  } finally {
    inflight = null;
  }
}

/** Test-only — clears the cached Page token between cases. */
export function _resetTokenCacheForTests(): void {
  cachedToken = null;
  inflight = null;
}
