/**
 * Meta Marketing API write operations (Phase B.1).
 *
 * Safety doctrine (ADR-015):
 *   - Every create_* tool hard-wires status='PAUSED' / unlisted-equivalent.
 *     There is NO `status` field in any tool's input schema.
 *   - No activate_* tool exists. Activation happens human-side in Ads Manager.
 *   - update_* refuses edits to live entities except budget-decrease and
 *     emergency-pause (end_time ≤ now).
 *   - pause_* is always allowed.
 *   - create_ad_creative runs checkCompliance() before posting.
 *   - Idempotency by client_request_id → mapped to entity name + existence
 *     check inside the parent (Meta Marketing API has no native idempotency
 *     key on /ads, so we implement it via name uniqueness).
 */

import { checkCompliance, type ComplianceLang } from "./compliance.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const META_API_VERSION = "v21.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`required env var ${name} is not set`);
  return v;
}

function adAccountPath(): string {
  const raw = requireEnv("AD_ACCOUNT_ID").trim();
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

interface MetaList<T> {
  data: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

async function metaGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", requireEnv("META_TOKEN"));
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Meta API ${res.status} GET ${path}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function metaPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}/${path}`);
  const form = new URLSearchParams();
  form.set("access_token", requireEnv("META_TOKEN"));
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new Error(`Meta API ${res.status} POST ${path}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/**
 * Multipart POST for raw-bytes uploads (Meta's /adimages and /advideos accept
 * both URL-fetch and multipart modes). Used when the caller hands over
 * `local_path` instead of `file_url` — the MCP reads the bytes off disk and
 * pushes them straight to Meta. Lets the local-disk asset-store work end-to-end
 * without a public CDN.
 *
 * Size note: Meta's non-resumable video upload accepts files up to ~1GB; for
 * larger videos the resumable upload protocol is required. v1 covers the
 * single-POST path only; resumable upload is a v1.5 follow-up if needed.
 */
async function metaPostMultipart<T>(
  path: string,
  fields: Record<string, string>,
  file: { field: string; filename: string; mime_type: string; bytes: Buffer },
): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}/${path}`);
  const form = new FormData();
  form.set("access_token", requireEnv("META_TOKEN"));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set(
    file.field,
    new Blob([new Uint8Array(file.bytes)], { type: file.mime_type }),
    file.filename,
  );
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(
      `Meta API ${res.status} POST ${path} (multipart): ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

interface EntityStatusResponse {
  id: string;
  status?: string;
  effective_status?: string;
  name?: string;
}

async function getEntityStatus(
  id: string,
): Promise<{ status?: string; effective_status?: string; name?: string }> {
  const res = await metaGet<EntityStatusResponse>(id, {
    fields: "id,status,effective_status,name",
  });
  return { status: res.status, effective_status: res.effective_status, name: res.name };
}

function isLive(effective_status?: string): boolean {
  // Meta returns effective_status values like ACTIVE, PAUSED, ARCHIVED,
  // CAMPAIGN_PAUSED, ADSET_PAUSED, PENDING_REVIEW, etc. Anything containing
  // ACTIVE counts as live (spend can happen).
  return typeof effective_status === "string" && effective_status === "ACTIVE";
}

// ──────────────────── idempotency helpers ────────────────────

interface AdSummary {
  id: string;
  name: string;
  status?: string;
}

async function findAdByName(adsetId: string, name: string): Promise<AdSummary | null> {
  const res = await metaGet<MetaList<AdSummary>>(`${adsetId}/ads`, {
    fields: "id,name,status",
    limit: "200",
  });
  return res.data.find((a) => a.name === name) ?? null;
}

interface AdSetSummary {
  id: string;
  name: string;
}

async function findAdSetByName(campaignId: string, name: string): Promise<AdSetSummary | null> {
  const res = await metaGet<MetaList<AdSetSummary>>(`${campaignId}/adsets`, {
    fields: "id,name",
    limit: "200",
  });
  return res.data.find((a) => a.name === name) ?? null;
}

interface CampaignSummary {
  id: string;
  name: string;
}

async function findCampaignByName(name: string): Promise<CampaignSummary | null> {
  const res = await metaGet<MetaList<CampaignSummary>>(`${adAccountPath()}/campaigns`, {
    fields: "id,name",
    limit: "200",
  });
  return res.data.find((a) => a.name === name) ?? null;
}

// ──────────────────── create_campaign ────────────────────

export interface CreateCampaignInput {
  name: string;
  objective:
    | "OUTCOME_TRAFFIC"
    | "OUTCOME_AWARENESS"
    | "OUTCOME_ENGAGEMENT"
    | "OUTCOME_LEADS"
    | "OUTCOME_SALES"
    | "OUTCOME_APP_PROMOTION";
  buying_type?: "AUCTION" | "RESERVED";
  special_ad_categories?: string[];
  /**
   * When true, Meta lets the campaign's ad-sets each carry their own budget
   * (no CBO). When omitted/false, Meta requires a campaign-level budget.
   * Required by Meta's Graph API on campaigns that will host ad-set-level
   * budgets — closes subcode 4834011 on create. Defaults to false to preserve
   * pre-existing behavior. (ADR-005 / Meta-paid-unblock spec §3.3.1.)
   */
  is_adset_budget_sharing_enabled?: boolean;
  client_request_id?: string;
}

export interface CreateCampaignResult {
  campaign_id: string;
  name: string;
  status: "PAUSED";
  idempotent_match: boolean;
}

export async function createCampaign(
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  if (input.client_request_id) {
    const existing = await findCampaignByName(input.name);
    if (existing) {
      return {
        campaign_id: existing.id,
        name: existing.name,
        status: "PAUSED",
        idempotent_match: true,
      };
    }
  }
  const body: Record<string, unknown> = {
    name: input.name,
    objective: input.objective,
    status: "PAUSED",
    buying_type: input.buying_type ?? "AUCTION",
    special_ad_categories: input.special_ad_categories ?? [],
    is_adset_budget_sharing_enabled: String(
      input.is_adset_budget_sharing_enabled ?? false,
    ),
  };
  const res = await metaPost<{ id: string }>(`${adAccountPath()}/campaigns`, body);
  return {
    campaign_id: res.id,
    name: input.name,
    status: "PAUSED",
    idempotent_match: false,
  };
}

// ──────────────────── create_adset ────────────────────

export interface CreateAdSetInput {
  name: string;
  campaign_id: string;
  daily_budget_cents: number;
  optimization_goal: string;
  billing_event: string;
  bid_strategy?: string;
  targeting: Record<string, unknown>;
  start_time?: string;
  end_time?: string;
  client_request_id?: string;
}

export interface CreateAdSetResult {
  adset_id: string;
  name: string;
  status: "PAUSED";
  idempotent_match: boolean;
}

export async function createAdSet(input: CreateAdSetInput): Promise<CreateAdSetResult> {
  if (input.client_request_id) {
    const existing = await findAdSetByName(input.campaign_id, input.name);
    if (existing) {
      return {
        adset_id: existing.id,
        name: existing.name,
        status: "PAUSED",
        idempotent_match: true,
      };
    }
  }
  const body: Record<string, unknown> = {
    name: input.name,
    campaign_id: input.campaign_id,
    status: "PAUSED",
    daily_budget: input.daily_budget_cents,
    optimization_goal: input.optimization_goal,
    billing_event: input.billing_event,
    bid_strategy: input.bid_strategy,
    targeting: input.targeting,
    start_time: input.start_time,
    end_time: input.end_time,
  };
  const res = await metaPost<{ id: string }>(`${adAccountPath()}/adsets`, body);
  return {
    adset_id: res.id,
    name: input.name,
    status: "PAUSED",
    idempotent_match: false,
  };
}

// ──────────────────── update_adset (guarded) ────────────────────

export interface UpdateAdSetInput {
  adset_id: string;
  /** Optional: new daily budget in cents. If the entity is live, only decreases are allowed. */
  daily_budget_cents?: number;
  /** Optional: emergency end. Setting end_time to a past/now value stops spend; allowed on live entities. */
  end_time?: string;
  /** Edits below are only allowed on non-live (paused) entities. */
  targeting?: Record<string, unknown>;
  name?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
}

export interface UpdateAdSetResult {
  adset_id: string;
  applied: string[];
  was_live: boolean;
}

function isEmergencyEnd(end_time?: string): boolean {
  if (!end_time) return false;
  const parsed = Date.parse(end_time);
  if (Number.isNaN(parsed)) return false;
  return parsed <= Date.now();
}

export async function updateAdSet(input: UpdateAdSetInput): Promise<UpdateAdSetResult> {
  const cur = await getEntityStatus(input.adset_id);
  const live = isLive(cur.effective_status);

  if (live) {
    // Live entity: only allow budget-decrease or emergency-pause via end_time.
    const livePayload: Record<string, unknown> = {};
    const applied: string[] = [];

    if (input.daily_budget_cents !== undefined) {
      const curRes = await metaGet<{ daily_budget?: string | number }>(input.adset_id, {
        fields: "daily_budget",
      });
      const curBudget = Number(curRes.daily_budget ?? 0);
      if (input.daily_budget_cents >= curBudget) {
        throw new Error(
          `REFUSED: live adset, daily_budget can only be DECREASED (current=${curBudget}, requested=${input.daily_budget_cents}). Pause the adset first if you need to raise budget.`,
        );
      }
      livePayload["daily_budget"] = input.daily_budget_cents;
      applied.push("daily_budget");
    }

    if (input.end_time !== undefined) {
      if (!isEmergencyEnd(input.end_time)) {
        throw new Error(
          `REFUSED: live adset, end_time may only be set to ≤ now (emergency-pause). For scheduled end-time changes, pause the adset first.`,
        );
      }
      livePayload["end_time"] = input.end_time;
      applied.push("end_time");
    }

    const disallowed = (["targeting", "name", "optimization_goal", "billing_event", "bid_strategy"] as const).filter(
      (k) => input[k] !== undefined,
    );
    if (disallowed.length > 0) {
      throw new Error(
        `REFUSED: live adset, only daily_budget (decrease) and end_time (≤now) allowed. ` +
          `Disallowed edits requested: ${disallowed.join(", ")}. Pause the adset first.`,
      );
    }

    if (applied.length === 0) {
      return { adset_id: input.adset_id, applied: [], was_live: true };
    }

    await metaPost(input.adset_id, livePayload);
    return { adset_id: input.adset_id, applied, was_live: true };
  }

  // Paused entity: all edits allowed.
  const payload: Record<string, unknown> = {};
  const applied: string[] = [];
  for (const k of ["daily_budget_cents", "end_time", "targeting", "name", "optimization_goal", "billing_event", "bid_strategy"] as const) {
    if (input[k] === undefined) continue;
    const field = k === "daily_budget_cents" ? "daily_budget" : k;
    payload[field] = input[k];
    applied.push(field);
  }
  if (applied.length === 0) {
    return { adset_id: input.adset_id, applied: [], was_live: false };
  }
  await metaPost(input.adset_id, payload);
  return { adset_id: input.adset_id, applied, was_live: false };
}

// ──────────────────── pause_* ────────────────────

export async function pauseAdSet(adset_id: string): Promise<{ adset_id: string; status: "PAUSED" }> {
  await metaPost(adset_id, { status: "PAUSED" });
  return { adset_id, status: "PAUSED" };
}

export async function pauseAd(ad_id: string): Promise<{ ad_id: string; status: "PAUSED" }> {
  await metaPost(ad_id, { status: "PAUSED" });
  return { ad_id, status: "PAUSED" };
}

export async function pauseCampaign(
  campaign_id: string,
): Promise<{ campaign_id: string; status: "PAUSED" }> {
  await metaPost(campaign_id, { status: "PAUSED" });
  return { campaign_id, status: "PAUSED" };
}

// ──────────────────── upload_video ────────────────────

export interface UploadVideoInput {
  /** EITHER provide a URL Meta can fetch... */
  file_url?: string;
  /** ...OR a local filesystem path; the MCP reads the bytes and posts multipart. */
  local_path?: string;
  /** Override MIME type when uploading by local_path (default: video/mp4). Ignored for file_url mode. */
  mime_type?: string;
  name?: string;
  title?: string;
  description?: string;
}

export interface UploadVideoResult {
  video_id: string;
  /**
   * Meta returns the video in PROCESSING/READY/ERROR state asynchronously.
   * The MCP only kicks off the upload; the caller must poll `get_video_status`
   * if it needs to know when the video is usable in ad creative.
   */
  initial_status: "processing" | "ready" | "unknown";
  /** Reports which upload mode was used. Mostly for debugging. */
  mode: "url" | "multipart";
}

function exactlyOne(a: unknown, b: unknown): boolean {
  return (a == null) !== (b == null);
}

export async function uploadVideo(input: UploadVideoInput): Promise<UploadVideoResult> {
  if (!exactlyOne(input.file_url, input.local_path)) {
    throw new Error("upload_video: exactly one of file_url or local_path must be provided");
  }

  let res: { id: string; status?: { video_status?: string } };
  let mode: "url" | "multipart";

  if (input.local_path) {
    if (!existsSync(input.local_path)) {
      throw new Error(`upload_video: local_path does not exist: ${input.local_path}`);
    }
    const bytes = await readFile(input.local_path);
    const filename = basename(input.local_path);
    const fields: Record<string, string> = {};
    if (input.name) fields["name"] = input.name;
    if (input.title) fields["title"] = input.title;
    if (input.description) fields["description"] = input.description;
    res = await metaPostMultipart(
      `${adAccountPath()}/advideos`,
      fields,
      {
        field: "source",
        filename,
        mime_type: input.mime_type ?? "video/mp4",
        bytes,
      },
    );
    mode = "multipart";
  } else {
    res = await metaPost(
      `${adAccountPath()}/advideos`,
      {
        file_url: input.file_url,
        name: input.name,
        title: input.title,
        description: input.description,
      },
    );
    mode = "url";
  }

  const vs = res.status?.video_status?.toLowerCase();
  const initial_status =
    vs === "ready" ? "ready" : vs === "processing" ? "processing" : "unknown";
  return { video_id: res.id, initial_status, mode };
}

// ──────────────────── upload_image ────────────────────

export interface UploadImageInput {
  /** EITHER provide a URL Meta can fetch... */
  file_url?: string;
  /** ...OR a local filesystem path; the MCP reads the bytes and posts multipart. */
  local_path?: string;
  /** Override MIME type when uploading by local_path (default: image/png). Ignored for file_url mode. */
  mime_type?: string;
  name?: string;
}

export interface UploadImageResult {
  image_hash: string;
  url: string;
  /** Reports which upload mode was used. Mostly for debugging. */
  mode: "url" | "multipart";
}

export async function uploadImage(input: UploadImageInput): Promise<UploadImageResult> {
  if (!exactlyOne(input.file_url, input.local_path)) {
    throw new Error("upload_image: exactly one of file_url or local_path must be provided");
  }

  let res: { images: Record<string, { hash: string; url: string }> };
  let mode: "url" | "multipart";

  if (input.local_path) {
    if (!existsSync(input.local_path)) {
      throw new Error(`upload_image: local_path does not exist: ${input.local_path}`);
    }
    const bytes = await readFile(input.local_path);
    const filename = basename(input.local_path);
    // Meta's /adimages multipart shape: the field name IS the filename, value is bytes.
    // The response keys `images` by that filename.
    res = await metaPostMultipart(
      `${adAccountPath()}/adimages`,
      input.name ? { name: input.name } : {},
      {
        field: filename,
        filename,
        mime_type: input.mime_type ?? "image/png",
        bytes,
      },
    );
    mode = "multipart";
  } else {
    // Meta gates the url-fetch variant of /adimages (the `url=` param, where Meta
    // fetches the asset itself) behind a capability many apps lack — it returns
    // OAuthException code 3 even for a reachable asset. Raw multipart byte upload
    // is permitted on the same app/account. So we fetch the asset ourselves and
    // push the bytes multipart, exactly like the local_path branch. (2026-05-29)
    const fileUrl = input.file_url!;
    const assetRes = await fetch(fileUrl);
    if (!assetRes.ok) {
      throw new Error(
        `upload_image: failed to fetch file_url ${fileUrl} (HTTP ${assetRes.status})`,
      );
    }
    const bytes = Buffer.from(await assetRes.arrayBuffer());
    const filename = basename(new URL(fileUrl).pathname) || "image.png";
    const mime_type =
      assetRes.headers.get("content-type") ?? input.mime_type ?? "image/png";
    res = await metaPostMultipart(
      `${adAccountPath()}/adimages`,
      input.name ? { name: input.name } : {},
      { field: filename, filename, mime_type, bytes },
    );
    mode = "multipart";
  }

  const entries = Object.entries(res.images ?? {});
  if (entries.length === 0) {
    throw new Error(`Meta /adimages returned no image entries: ${JSON.stringify(res)}`);
  }
  const [, first] = entries[0]!;
  return { image_hash: first.hash, url: first.url, mode };
}

// ──────────────────── create_ad_creative ────────────────────

export interface CreateAdCreativeInput {
  name: string;
  /** Optional — defaults to env META_ORGANIC_PAGE_ID. */
  page_id?: string;
  /** Required for compliance check + Meta API. Plain text shown to user. */
  primary_text: string;
  headline?: string;
  description?: string;
  /** Either video_id or image_hash must be supplied. */
  video_id?: string;
  image_hash?: string;
  /** Destination URL (link the ad clicks through to). Optional — defaults to env LANDING_URL. */
  link_url?: string;
  /** Bare string (CTA type) or the full Meta object shape. Extra value keys (app_destination, whatsapp_number, etc.) are preserved. */
  call_to_action?: string | { type: string; value?: { link?: string; [key: string]: unknown } };
  lang: ComplianceLang;
}

export interface CreateAdCreativeResult {
  creative_id: string;
  name: string;
  compliance_matched_phrase: string;
}

export async function createAdCreative(
  input: CreateAdCreativeInput,
): Promise<CreateAdCreativeResult> {
  // ADR-015 enforcement: compliance check inside the create path, BEFORE Meta call.
  const check = checkCompliance({
    primary_text: input.primary_text,
    headline: input.headline,
    description: input.description,
    lang: input.lang,
  });
  if (!check.ok) {
    throw new Error(check.refusal_reason ?? "REFUSED: compliance check failed");
  }
  if (!input.video_id && !input.image_hash) {
    throw new Error("create_ad_creative: either video_id or image_hash is required");
  }

  // Resolve deploy-config defaults from env.
  // Same Page backs both organic posts and paid creatives.
  const page_id = input.page_id ?? requireEnv("META_ORGANIC_PAGE_ID");
  const link_url = input.link_url ?? requireEnv("LANDING_URL");

  // Normalize call_to_action: bare string → {type, value:{link}}; object → fill value.link if absent.
  const call_to_action =
    typeof input.call_to_action === "string"
      ? { type: input.call_to_action, value: { link: link_url } }
      : input.call_to_action
        ? { ...input.call_to_action, value: { ...input.call_to_action.value, link: input.call_to_action.value?.link ?? link_url } }
        : undefined;

  // Build object_story_spec — Meta's preferred shape for native ad creatives.
  const link_data: Record<string, unknown> = {
    message: input.primary_text,
    link: link_url,
    name: input.headline,
    description: input.description,
    call_to_action,
  };
  if (input.image_hash) link_data["image_hash"] = input.image_hash;

  const video_data: Record<string, unknown> | undefined = input.video_id
    ? {
        video_id: input.video_id,
        message: input.primary_text,
        title: input.headline,
        call_to_action,
        link_description: input.description,
      }
    : undefined;

  const object_story_spec: Record<string, unknown> = {
    page_id,
  };
  if (video_data) {
    object_story_spec["video_data"] = video_data;
  } else {
    object_story_spec["link_data"] = link_data;
  }

  const res = await metaPost<{ id: string }>(`${adAccountPath()}/adcreatives`, {
    name: input.name,
    object_story_spec,
  });
  return {
    creative_id: res.id,
    name: input.name,
    compliance_matched_phrase: check.matched_phrase ?? "(unknown)",
  };
}

// ──────────────────── create_ad ────────────────────

export interface CreateAdInput {
  name: string;
  adset_id: string;
  creative_id: string;
  client_request_id?: string;
}

export interface CreateAdResult {
  ad_id: string;
  name: string;
  status: "PAUSED";
  idempotent_match: boolean;
}

export async function createAd(input: CreateAdInput): Promise<CreateAdResult> {
  if (input.client_request_id) {
    const existing = await findAdByName(input.adset_id, input.name);
    if (existing) {
      return {
        ad_id: existing.id,
        name: existing.name,
        status: "PAUSED",
        idempotent_match: true,
      };
    }
  }
  const res = await metaPost<{ id: string }>(`${adAccountPath()}/ads`, {
    name: input.name,
    adset_id: input.adset_id,
    creative: { creative_id: input.creative_id },
    status: "PAUSED",
  });
  return {
    ad_id: res.id,
    name: input.name,
    status: "PAUSED",
    idempotent_match: false,
  };
}

// ──────────────────── update_ad (guarded) ────────────────────

export interface UpdateAdInput {
  ad_id: string;
  /** Allowed on paused ads only. Replacing creative on a live ad would require pause-then-edit. */
  creative_id?: string;
  name?: string;
}

export interface UpdateAdResult {
  ad_id: string;
  applied: string[];
  was_live: boolean;
}

export async function updateAd(input: UpdateAdInput): Promise<UpdateAdResult> {
  const cur = await getEntityStatus(input.ad_id);
  if (isLive(cur.effective_status)) {
    throw new Error(
      `REFUSED: live ad, no edits allowed. Pause the ad first (pause_ad), edit, then human re-activates.`,
    );
  }
  const payload: Record<string, unknown> = {};
  const applied: string[] = [];
  if (input.creative_id !== undefined) {
    payload["creative"] = { creative_id: input.creative_id };
    applied.push("creative");
  }
  if (input.name !== undefined) {
    payload["name"] = input.name;
    applied.push("name");
  }
  if (applied.length === 0) {
    return { ad_id: input.ad_id, applied: [], was_live: false };
  }
  await metaPost(input.ad_id, payload);
  return { ad_id: input.ad_id, applied, was_live: false };
}

// ──────────────────── get_entity_status ────────────────────

export interface GetEntityStatusInput {
  entity_id: string;
}

export interface GetEntityStatusResult {
  entity_id: string;
  status?: string;
  effective_status?: string;
  name?: string;
}

export async function getEntityStatusTool(
  input: GetEntityStatusInput,
): Promise<GetEntityStatusResult> {
  const cur = await getEntityStatus(input.entity_id);
  return { entity_id: input.entity_id, ...cur };
}

// ──────────────────── list_ads ────────────────────

export interface ListAdsInput {
  /** Scope to a parent entity. One of adset_id / campaign_id is required; both → adset_id wins. */
  adset_id?: string;
  campaign_id?: string;
  limit?: number;
}

export interface ListAdsResult {
  ads: { id: string; name: string; status?: string; effective_status?: string }[];
}

export async function listAds(input: ListAdsInput): Promise<ListAdsResult> {
  const parent = input.adset_id ?? input.campaign_id ?? adAccountPath();
  const res = await metaGet<MetaList<{ id: string; name: string; status?: string; effective_status?: string }>>(
    `${parent}/ads`,
    {
      fields: "id,name,status,effective_status",
      limit: String(input.limit ?? 100),
    },
  );
  return { ads: res.data };
}
