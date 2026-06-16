#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getInsights,
  listCampaigns,
  listCreatives,
  capiSend,
  capiTestEvent,
  createCampaign,
  createAdSet,
  updateAdSet,
  pauseAdSet,
  pauseAd,
  pauseCampaign,
  uploadVideo,
  uploadImage,
  createAdCreative,
  createAd,
  updateAd,
  getEntityStatusTool,
  listAds,
} from "@engineerdad/meta-ads";

const server = new McpServer({
  name: "meta-ads",
  version: "0.2.0",
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
  "get_insights",
  "Pull Meta Marketing API insights at campaign / adset / ad level. Default fields cover spend, impressions, ctr, cpm, actions. When level='ad', defaults time_increment='1' (daily rows) so decay curves have per-day resolution; pass time_increment='all_days' to collapse back to one window-spanning row.",
  {
    level: z.enum(["campaign", "adset", "ad"]),
    date_preset: z.enum(["last_7d", "last_14d", "last_30d", "last_90d"]).optional(),
    fields: z.array(z.string()).optional(),
    breakdowns: z.array(z.enum(["age", "gender", "placement", "region"])).optional(),
    time_increment: z.enum(["1", "all_days", "monthly"]).optional(),
  },
  async (args) => {
    try {
      return toolResult(await getInsights(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool("list_campaigns", "List all campaigns under the configured ad account.", {}, async () => {
  try {
    return toolResult(await listCampaigns());
  } catch (err) {
    return errorResult(err);
  }
});

server.tool(
  "list_creatives",
  "List ad creatives. If ad_ids supplied, returns the creative attached to each ad; otherwise lists account-level creatives.",
  {
    ad_ids: z.array(z.string()).optional(),
  },
  async (args) => {
    try {
      return toolResult(await listCreatives(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const CapiUserDataSchema = z.object({
  em: z.array(z.string()).optional(),
  ph: z.array(z.string()).optional(),
  fbp: z.string().optional(),
  fbc: z.string().optional(),
  client_ip_address: z.string().optional(),
  client_user_agent: z.string().optional(),
});

const CapiCustomDataSchema = z.object({
  value: z.number().optional(),
  currency: z.literal("MYR").optional(),
  content_ids: z.array(z.string()).optional(),
  content_name: z.string().optional(),
});

const CapiEventSchema = z.object({
  event_name: z.enum([
    "Lead",
    "Purchase",
    "CompleteRegistration",
    "ViewContent",
    "AddToCart",
    "Contact",
  ]),
  event_time: z.number().int().optional(),
  event_id: z.string().min(1),
  action_source: z.enum(["website", "system_generated", "app"]),
  event_source_url: z.string().url().optional(),
  user_data: CapiUserDataSchema,
  custom_data: CapiCustomDataSchema.optional(),
});

server.tool(
  "capi_send",
  "Send Conversions API events. v1 safety: if test_event_code is omitted, server injects META_CAPI_TEST_EVENT_CODE from env. If that is also unset, the call fails — never silently fires production events. PII (em, ph) is SHA-256 normalized server-side. If event_time is omitted, server fills in current Unix seconds (Meta rejects events older than 7 days).",
  {
    events: z.array(CapiEventSchema).min(1),
    test_event_code: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await capiSend(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "capi_test_event",
  "Fire a synthetic Lead test event so it appears in Meta Events Manager → Test Events tab. Useful for validating the CAPI path end-to-end.",
  {},
  async () => {
    try {
      return toolResult(await capiTestEvent());
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// WRITE TOOLS (ADR-015 safety doctrine)
// Safe state (PAUSED / unlisted) is hard-wired in the handler. No `status`
// field exists in any create_* schema. No activate_* tool exists, anywhere.
// ════════════════════════════════════════════════════════════════════════════

server.tool(
  "create_campaign",
  "Create a Meta campaign in PAUSED state. The campaign always lands paused — there is no `status` field in this schema. Activation is a human-only action in Ads Manager (ADR-015). Pass `client_request_id` to make retries idempotent (an existing campaign with the same `name` will be returned instead of creating a duplicate).",
  {
    name: z.string().min(1),
    objective: z.enum([
      "OUTCOME_TRAFFIC",
      "OUTCOME_AWARENESS",
      "OUTCOME_ENGAGEMENT",
      "OUTCOME_LEADS",
      "OUTCOME_SALES",
      "OUTCOME_APP_PROMOTION",
    ]),
    buying_type: z.enum(["AUCTION", "RESERVED"]).optional(),
    special_ad_categories: z.array(z.string()).optional(),
    is_adset_budget_sharing_enabled: z
      .boolean()
      .optional()
      .describe(
        "Set true only for campaigns whose ad sets will carry their own daily/lifetime budgets (no campaign-budget optimisation / no CBO). When false or omitted, the campaign requires a campaign-level budget. Meta returns subcode 4834011 if this flag disagrees with the ad-set budget shape. Defaults to false.",
      ),
    client_request_id: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await createCampaign(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "create_adset",
  "Create a Meta ad set in PAUSED state. Always lands paused — no `status` field exists. `daily_budget_cents` is the budget in account-currency minor units (cents/sen). `client_request_id` makes retries idempotent against `name` within the campaign.",
  {
    name: z.string().min(1),
    campaign_id: z.string().min(1),
    daily_budget_cents: z.number().int().positive(),
    optimization_goal: z.string().min(1),
    billing_event: z.string().min(1),
    bid_strategy: z.string().optional(),
    targeting: z.record(z.string(), z.unknown()),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    client_request_id: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await createAdSet(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "update_adset",
  "Edit a Meta ad set. On a PAUSED ad set, any field may be edited. On a LIVE ad set, only `daily_budget_cents` (DECREASE only) and `end_time` (≤ now, emergency-pause) are allowed; all other edits are refused. There is no path to raise spend or change targeting on a live ad set — pause it first.",
  {
    adset_id: z.string().min(1),
    daily_budget_cents: z.number().int().positive().optional(),
    end_time: z.string().optional(),
    targeting: z.record(z.string(), z.unknown()).optional(),
    name: z.string().optional(),
    optimization_goal: z.string().optional(),
    billing_event: z.string().optional(),
    bid_strategy: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await updateAdSet(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "pause_adset",
  "Set an ad set to PAUSED. Always allowed regardless of current state. Use as the kill-switch for runaway spend.",
  { adset_id: z.string().min(1) },
  async (args) => {
    try {
      return toolResult(await pauseAdSet(args.adset_id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "pause_ad",
  "Set an ad to PAUSED. Always allowed regardless of current state.",
  { ad_id: z.string().min(1) },
  async (args) => {
    try {
      return toolResult(await pauseAd(args.ad_id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "pause_campaign",
  "Set a campaign to PAUSED. Always allowed regardless of current state. Pauses every active ad and ad set under it.",
  { campaign_id: z.string().min(1) },
  async (args) => {
    try {
      return toolResult(await pauseCampaign(args.campaign_id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "upload_video",
  "Upload a video asset to the ad account. Provide EITHER `file_url` (Meta fetches the asset from a public URL) OR `local_path` (MCP reads bytes off disk and posts multipart — works even without a public CDN). Returns `video_id`, `initial_status`, and which `mode` was used. Meta ingests asynchronously; `video_id` becomes usable in `create_ad_creative` only once `initial_status` reaches 'ready' (poll `get_entity_status` against the video_id). Multipart mode is suitable for files up to ~1GB; larger videos need resumable upload (not implemented in v1).",
  {
    file_url: z.string().url().optional(),
    local_path: z.string().min(1).optional(),
    mime_type: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
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
  "upload_image",
  "Upload an image asset to the ad account. Provide EITHER `file_url` (Meta fetches from a public URL) OR `local_path` (MCP reads bytes off disk and posts multipart — works even without a public CDN). Returns `image_hash` (use in `create_ad_creative.image_hash`), the CDN `url`, and which `mode` was used.",
  {
    file_url: z.string().url().optional(),
    local_path: z.string().min(1).optional(),
    mime_type: z.string().optional(),
    name: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await uploadImage(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "create_ad_creative",
  "Create an ad creative. Runs a compliance check (sentinel-phrase against corpus/compliance regulator disclaimers) on primary_text+headline+description BEFORE posting to Meta — non-compliant copy is refused at this layer (ADR-015). Either `video_id` or `image_hash` is required. `lang` selects which language's regulator phrases to look for.",
  {
    name: z.string().min(1),
    page_id: z.string().min(1).optional(),
    primary_text: z.string().min(1),
    headline: z.string().optional(),
    description: z.string().optional(),
    video_id: z.string().optional(),
    image_hash: z.string().optional(),
    link_url: z.string().url().optional(),
    call_to_action: z
      .union([
        z.string(),
        z.object({
          type: z.string(),
          value: z.object({ link: z.string().url().optional() }).passthrough().optional(),
        }),
      ])
      .optional(),
    lang: z.enum(["en", "ms"]),
  },
  async (args) => {
    try {
      return toolResult(await createAdCreative(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "create_ad",
  "Create a Meta ad in PAUSED state. The ad always lands paused — there is no `status` field. Activation is human-only in Ads Manager (ADR-015). `client_request_id` makes retries idempotent: an existing ad with the same `name` in the same ad set returns its existing ad_id.",
  {
    name: z.string().min(1),
    adset_id: z.string().min(1),
    creative_id: z.string().min(1),
    client_request_id: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await createAd(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "update_ad",
  "Edit a Meta ad. REFUSED on live ads — pause first (pause_ad), edit, then human re-activates. On paused ads, allows creative_id swap and rename.",
  {
    ad_id: z.string().min(1),
    creative_id: z.string().optional(),
    name: z.string().optional(),
  },
  async (args) => {
    try {
      return toolResult(await updateAd(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_entity_status",
  "Read status + effective_status + name for a campaign, ad set, or ad ID. Read-only.",
  { entity_id: z.string().min(1) },
  async (args) => {
    try {
      return toolResult(await getEntityStatusTool(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_ads",
  "List ads. Provide adset_id or campaign_id to scope; without either, lists account-level. Returns id, name, status, effective_status. Read-only.",
  {
    adset_id: z.string().optional(),
    campaign_id: z.string().optional(),
    limit: z.number().int().positive().optional(),
  },
  async (args) => {
    try {
      return toolResult(await listAds(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
