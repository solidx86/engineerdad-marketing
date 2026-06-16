#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  banditAllocate,
  banditUpdate,
  costPerAngle,
  decayCurve,
  engagementPerAngle,
  ingestMetaInsights,
  ingestMetaOrganicInsights,
  logEvent,
  topCreatives,
  upsertCreative,
  ArmTagSchema,
  CreativeSchema,
  IngestMetaInsightsInputSchema,
} from "@engineerdad/analytics";

const server = new McpServer({ name: "analytics", version: "0.1.0" });

const toolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});
const errorResult = (err: unknown) => ({
  isError: true,
  content: [
    { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
  ],
});

server.tool(
  "ingest_meta_insights",
  "Insert (upsert) Meta insights rows into the analytics Postgres schema. v1 deviation: takes pre-fetched rows[] (agent calls meta-ads.get_insights first, then pipes here). Keeps analytics network-free.",
  IngestMetaInsightsInputSchema.shape,
  async (args) => {
    try { return toolResult(await ingestMetaInsights(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "upsert_creative",
  "Upsert a creative + its angle/hook/persona/format/language tags. Tags drive bandit arm aggregation.",
  CreativeSchema.shape,
  async (args) => {
    try { return toolResult(await upsertCreative(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "decay_curve",
  "Per-day metric trend for one ad. metric ∈ ctr | cpm | cpa. channel defaults to 'meta-paid' (back-compat); pass 'meta-organic' for organic signals from creative_signals.",
  {
    ad_id: z.string().min(1),
    metric: z.enum(["ctr", "cpm", "cpa"]),
    channel: z.string().optional(),
  },
  async (args) => {
    try { return toolResult(await decayCurve(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "cost_per_angle",
  "Aggregate spend / leads / CPA per angle tag over the last N days. channel defaults to 'meta-paid' (back-compat); pass 'meta-organic' for organic kpi_value aggregation from creative_signals.",
  {
    window_days: z.number().int().positive(),
    channel: z.string().optional(),
  },
  async (args) => {
    try { return toolResult(await costPerAngle(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "top_creatives",
  "Top N creatives by score = 1/CPA + CTR over the window. channel defaults to 'meta-paid' (back-compat); pass 'meta-organic' to rank by total kpi_value from creative_signals.",
  {
    window_days: z.number().int().positive(),
    n: z.number().int().positive().max(100),
    channel: z.string().optional(),
  },
  async (args) => {
    try { return toolResult(await topCreatives(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "log_event",
  "Append a synthetic event row (used by tracking subagent's CAPI test path).",
  {
    event_name: z.string().min(1),
    payload: z.unknown().optional(),
  },
  async (args) => {
    try { return toolResult(await logEvent(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "bandit_allocate",
  "Beta-Bernoulli + Thompson sampling. Cross-product over arm_tags only — caller controls cardinality. 70/20/10 bucket labels are derived from allocation quartiles, not pre-decided.",
  {
    arm_tags: z.array(ArmTagSchema).min(1),
    window_days: z.number().int().positive().optional(),
    budget_total_myr: z.number().positive(),
    exploration_weight: z.number().min(0).max(1).optional(),
    cold_start_strategy: z.enum(["uniform", "proof_led"]).optional(),
  },
  async (args) => {
    try { return toolResult(await banditAllocate(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "bandit_update",
  "Recompute Beta posterior parameters per arm from the current window. Read-only against meta_insights.",
  {
    window_days: z.number().int().positive(),
    arm_tags: z.array(ArmTagSchema).optional(),
  },
  async (args) => {
    try { return toolResult(await banditUpdate(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "ingest_meta_organic_insights",
  "Pull organic post insights from Meta Graph API for the supplied variants (already-resolved IG/FB Post IDs) and normalise into creative_signals. Idempotent — duplicate rows are silently ignored.",
  {
    variants: z.array(
      z.object({
        variantId: z.string().min(1),
        igPostId: z.string().optional(),
        fbPostId: z.string().optional(),
        isReel: z.boolean().optional(),
      }),
    ).min(1),
    sinceTs: z.number().int().optional(),
  },
  async (args) => {
    try {
      const result = await ingestMetaOrganicInsights({
        variants: args.variants,
        nowUnix: args.sinceTs,
      });
      return toolResult(result);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "engagement_per_angle",
  "Organic analog of cost_per_angle: aggregates saves/shares/reach/engagement_rate per angle from creative_signals, grouped by a caller-supplied variantId→angle map.",
  {
    channel: z.string().min(1),
    sinceTs: z.number().int(),
    angleByVariant: z.record(z.string(), z.string()),
  },
  async (args) => {
    try { return toolResult(await engagementPerAngle(args)); }
    catch (err) { return errorResult(err); }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
