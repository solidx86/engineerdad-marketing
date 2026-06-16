import type {
  BuildContext,
  RunState,
  StageDefinition,
  Step,
  StepSpec,
  VerifyResult,
} from "../types.js";
import type { DecisionMemoV2 } from "@engineerdad/shared";
import type { AllocatedCell } from "../experiment/allocation.js";
import {
  planMetaPaidSetup,
  planMetaPaidRows,
  planYouTube,
  planArticles,
  planOrganic,
  type DistVariant,
  type DistArticle,
  type MetaSpec,
  type YtSpec,
  type PlanPart,
  type RowPlan,
  type ToolStep,
} from "../distribute/plan-distribution.js";
import { verifyDistribute } from "../verifiers/verify-distribute.js";
import { metaPaidMode } from "../config.js";

/**
 * Field lists that the D1/D3 store queries must request to back the
 * row → DistVariant / DistArticle projection. The store's `query()` returns
 * only `id` + `title` by default (bulk content never crosses the wire); these
 * lists name every column the projection reads.
 */
const VARIANT_FIELDS = [
  "format",
  "aspect",
  "channels",
  "assetFiles",
  "adId",
  "ytVideoId",
  "ytTitle",
  "ytDescription",
  "ytTags",
  "ytCategory",
  "metaPrimaryTextEn",
  "metaPrimaryTextBm",
  "metaHeadlineEn",
  "metaHeadlineBm",
  "metaDescriptionEn",
  "metaDescriptionBm",
  "metaCtaType",
  "metaTargetingJson",
  "fbPostId",
  "organicCaptionEn",
  "organicCaptionBm",
  "organicLanguage",
  "organicScheduledFor",
];

const ARTICLE_FIELDS = [
  "title",
  "titleBm",
  "slug",
  "description",
  "topicTag",
  "readingTime",
  "keywords",
  "ogImageUrl",
  "heroImageUrl",
  "heroImageAlt",
  "bodyEn",
  "bodyBm",
  "faqEn",
  "faqBm",
  "deliveredAt",
];

/**
 * The distribute stage — routes approved content to its platforms.
 *
 * D1-query (write) → D2a-setup (spawn — Meta campaign + per-cell adsets) →
 * D2b-route (fanout — one worker per (row × channel)) → D3a-confirm (write —
 * re-query the store, no verify; just makes the actual state available to
 * D3b) → D3b-summary (write — emit per-(variant × channel) Distributions
 * audit rows AND verify the ground-truth, halting the loop if any expected
 * variant didn't land). Terminal — no human gate (ADR-015 amendment): under
 * the default META_PAID_MODE=manual the Meta-paid ads are created by hand
 * from the webapp posting pack, so there is no API spend to gate.
 *
 * Why D3a has no verify and D3b carries it: the audit log must be written
 * regardless of distribute success. If D3a halted on verify failure, the
 * Distributions trail would be missing exactly the rows operators most need
 * to see (the failures). D3b writes the rows first, then verifies.
 */

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/**
 * Read priority: Brain memo experimentParams (the experimental budget the
 * hypothesis was designed around) → run.params (CLI override) → 0 (caught
 * by adsetStep's Math.max(1, …) floor).
 *
 * Spec: docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html §3.3.2
 */
export function dailyBudgetMyrFor(run: RunState): number {
  const memo = stepResult<DecisionMemoV2>(run, "S1-reason");
  const fromMemo = memo?.experimentParams?.dailyBudgetMyr;
  if (typeof fromMemo === "number") return fromMemo;
  const params = run.params as unknown as { dailyBudgetMyr?: number };
  return params.dailyBudgetMyr ?? 0;
}

/** Flatten one mcp__store__query call-result into a row array. */
function rowsOf(callResult: unknown): unknown[] {
  return Array.isArray(callResult) ? callResult : [];
}

/** The allocated cells out of an Experiment row's Cells field (JSON or array). */
function cellsOf(experimentRow: unknown): AllocatedCell[] {
  if (experimentRow === null || typeof experimentRow !== "object") return [];
  const raw =
    (experimentRow as { cells?: unknown }).cells ??
    (experimentRow as { Cells?: unknown }).Cells;
  if (Array.isArray(raw)) return raw as AllocatedCell[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as AllocatedCell[];
    } catch {
      return [];
    }
  }
  return [];
}

// ── Row → DistVariant / DistArticle projection ───────────────────────────
//
// The store returns raw column rows; planDistribution expects DistVariant /
// DistArticle with composite shapes (metaSpec, ytSpec, adId object, cellId
// derived from the experiment). These helpers do the projection.

function asString(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

function asNullableString(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asArray<T = unknown>(row: Record<string, unknown>, key: string): T[] {
  const v = row[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Parse `adId` text into {en, ms} | null. Accepts JSON object or bare string. */
function parseAdId(raw: unknown): { en: string | null; ms: string | null } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const en = typeof o.en === "string" ? o.en : null;
    const ms = typeof o.ms === "string" ? o.ms : null;
    return en || ms ? { en, ms } : null;
  }
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parseAdId(parsed);
    } catch {
      return { en: raw, ms: null };
    }
  }
  return null;
}

/** Build MetaSpec composite from the row's meta_* columns; null if empty. */
function buildMetaSpec(row: Record<string, unknown>): MetaSpec | null {
  const primaryTextEn = asString(row, "metaPrimaryTextEn");
  const primaryTextMs = asString(row, "metaPrimaryTextBm");
  const headlineEn = asString(row, "metaHeadlineEn");
  const headlineMs = asString(row, "metaHeadlineBm");
  if (!primaryTextEn && !primaryTextMs && !headlineEn && !headlineMs) return null;
  return {
    primaryTextEn,
    primaryTextMs,
    headlineEn,
    headlineMs,
    descriptionEn: asString(row, "metaDescriptionEn"),
    descriptionMs: asString(row, "metaDescriptionBm"),
    ctaType: asString(row, "metaCtaType"),
    targetingJson: asString(row, "metaTargetingJson"),
  };
}

/** Build YtSpec composite from the row's yt_* columns; null if empty. */
function buildYtSpec(row: Record<string, unknown>): YtSpec | null {
  const title = asString(row, "ytTitle");
  const description = asString(row, "ytDescription");
  if (!title && !description) return null;
  return {
    title,
    description,
    tags: asArray<string>(row, "ytTags"),
    category: asString(row, "ytCategory"),
  };
}

/** Pick the organic caption matching the row's organicLanguage. */
function organicCaptionFor(row: Record<string, unknown>): string | null {
  const lang = asString(row, "organicLanguage").toLowerCase();
  if (lang === "ms" || lang === "bm") return asNullableString(row, "organicCaptionBm");
  if (lang === "en") return asNullableString(row, "organicCaptionEn");
  return asNullableString(row, "organicCaptionEn") ?? asNullableString(row, "organicCaptionBm");
}

/** Reverse-lookup: which allocated cell contains this variant's id, if any. */
function cellIdFor(variantId: string, cells: AllocatedCell[]): string | null {
  const hit = cells.find((c) => c.variantPageIds.includes(variantId));
  return hit ? hit.cellId : null;
}

/** Coerce a Date / ISO-string field to an ISO string, or null. */
function isoOrNull(raw: unknown): string | null {
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "string" && raw.length > 0) return raw;
  return null;
}

/** Raw CreativeVariants row → DistVariant. Tolerant of pre-projected fixtures. */
function projectVariant(row: Record<string, unknown>, cells: AllocatedCell[]): DistVariant {
  const id = asString(row, "id");
  // Idempotent: if the row already carries a `rowId`, treat it as pre-projected
  // (test fixtures do this); otherwise derive from the row's id.
  const rowId = asString(row, "rowId") || id;
  const variantId = asString(row, "variantId") || id;
  const channels = asArray<string>(row, "channels");
  const assetFiles = asArray<{ url: string }>(row, "assetFiles");
  const preMeta = row["metaSpec"];
  const preYt = row["ytSpec"];
  return {
    rowId,
    variantId,
    format: asString(row, "format"),
    aspect: asString(row, "aspect"),
    channels,
    assetFiles,
    adId: parseAdId(row["adId"]),
    ytVideoId: asNullableString(row, "ytVideoId"),
    metaSpec: preMeta && typeof preMeta === "object" ? (preMeta as MetaSpec) : buildMetaSpec(row),
    ytSpec: preYt && typeof preYt === "object" ? (preYt as YtSpec) : buildYtSpec(row),
    cellId: asNullableString(row, "cellId") ?? cellIdFor(variantId, cells),
    fbPostId: asNullableString(row, "fbPostId"),
    organicScheduledFor: isoOrNull(row["organicScheduledFor"]),
    organicCaption: organicCaptionFor(row),
    organicLang: asNullableString(row, "organicLanguage"),
  };
}

/** Raw AuthorityArticles row → DistArticle. Tolerant of pre-projected fixtures. */
function projectArticle(row: Record<string, unknown>): DistArticle {
  const id = asString(row, "id");
  const rowId = asString(row, "rowId") || id;
  return {
    rowId,
    slug: asString(row, "slug"),
    titleEn: asNullableString(row, "titleEn") ?? asNullableString(row, "title"),
    titleMs: asNullableString(row, "titleMs") ?? asNullableString(row, "titleBm"),
    description: asNullableString(row, "description"),
    topicTag: asNullableString(row, "topicTag"),
    readingTime: asNullableString(row, "readingTime"),
    keywords: asArray<string>(row, "keywords"),
    ogImageUrl: asNullableString(row, "ogImageUrl") ?? asNullableString(row, "ogImage"),
    datePublished: asNullableString(row, "datePublished"),
    heroImageUrl: asNullableString(row, "heroImageUrl"),
    heroImageAlt: asNullableString(row, "heroImageAlt"),
    bodyEn: asNullableString(row, "bodyEn"),
    bodyMs: asNullableString(row, "bodyMs") ?? asNullableString(row, "bodyBm"),
    faqEn: asNullableString(row, "faqEn"),
    faqMs: asNullableString(row, "faqMs") ?? asNullableString(row, "faqBm"),
    deliveredAt: isoOrNull(row["deliveredAt"]),
  };
}

function projectVariants(rows: unknown[], cells: AllocatedCell[]): DistVariant[] {
  return rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map((r) => projectVariant(r, cells));
}

function projectArticles(rows: unknown[]): DistArticle[] {
  return rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map((r) => projectArticle(r));
}

interface DistributeParams {
  channelFilter?: string[];
  dryRun?: boolean;
  dailyBudgetMyr?: number;
}

const d1Query: StepSpec = {
  id: "D1-query",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "D1-query",
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "CreativeVariants",
          filter: { runId: run.runId, approvalStatus: "Approved" },
          fields: VARIANT_FIELDS,
        },
      },
      {
        tool: "mcp__store__query",
        args: {
          entity: "AuthorityArticles",
          filter: {
            runId: run.runId,
            approvalStatus: "Approved",
            deliveredAt: { isNull: true },
          },
          fields: ARTICLE_FIELDS,
        },
      },
      {
        tool: "mcp__store__query",
        args: { entity: "Experiments", filter: { runId: run.runId }, fields: ["cells"] },
      },
    ],
  }),
};

const d3aConfirm: StepSpec = {
  id: "D3a-confirm",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "D3a-confirm",
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "CreativeVariants",
          filter: { runId: run.runId },
          fields: VARIANT_FIELDS,
        },
      },
      {
        tool: "mcp__store__query",
        args: {
          entity: "AuthorityArticles",
          filter: { runId: run.runId },
          fields: ARTICLE_FIELDS,
        },
      },
    ],
  }),
  // No verify — D3a just re-queries ground truth so D3b can compare against
  // D1's expected snapshot. The audit log + halt decision both live in D3b.
};

// ── D2a-setup ────────────────────────────────────────────────────────────
//
// A spawn step that creates the Meta campaign + per-cell adsets in a single
// worker, with the staged input fetched on entry via
// mcp__orchestrator__read_step_result (ADR-024).

function setupPromptFor(runId: string, ref: string): string {
  return [
    `Run ${runId}: You are the Meta paid setup worker. Your job: create the campaign and`,
    "per-cell adsets so the row-level worker can attach ads to them.",
    "",
    "Your FIRST action: call",
    `  mcp__orchestrator__read_step_result({ stepResultId: "${ref}" })`,
    "to fetch your staged input { setupSteps, dryRun }.",
    "",
    "Procedure:",
    "1. If `setupSteps` is empty, skip execution — there is no Meta routing for",
    "   this run (your result object will have campaignId: null, adsetByCellId: {}).",
    "2. Otherwise execute each step in `setupSteps` IN ORDER. Each step has",
    "   `captures` — remember its result keyed by that label (e.g. \"campaign\",",
    "   \"adset:cell-A\"). Honor `needs` — substitute the captured label for",
    "   placeholders in the call's args before invoking the tool.",
    "3. If `dryRun` is true, do NOT execute any call — walk the steps and",
    "   report what you would have called.",
    "",
    "Build your result object: { campaignId, adsetByCellId: { cellId: adsetId, ... } }.",
    "Then, before your final message, call",
    `  mcp__orchestrator__write_step_result({ runId: "${runId}", stepId: "D2a-setup", payload: <your result object> })`,
    "and return ONLY { stepResultId } as your final message (ADR-022 claim-check).",
  ].join("\n");
}

const d2aSetup: StepSpec = {
  id: "D2a-setup",
  kind: "spawn",
  build: async (run: RunState, ctx: BuildContext): Promise<Step> => {
    const d1 = stepResult<unknown[]>(run, "D1-query") ?? [];
    const cells = cellsOf(rowsOf(d1[2])[0]);
    const variants = projectVariants(rowsOf(d1[0]), cells);
    const params = run.params as unknown as DistributeParams;
    // Manual mode (Meta business verification pending): no API setup — the
    // campaign/adsets are created by hand from the webapp posting pack. Stage
    // an empty setup so the worker no-ops.
    const setupPart: PlanPart =
      metaPaidMode() === "manual"
        ? { setup: [], rowPlans: [], backfills: [], skipped: [], notes: [] }
        : planMetaPaidSetup(run.runId, variants, cells, dailyBudgetMyrFor(run));
    const ref = await ctx.stageInput(null, {
      setupSteps: setupPart.setup,
      dryRun: params.dryRun ?? false,
    });
    return {
      kind: "spawn",
      stepId: "D2a-setup",
      agent: "general-purpose",
      spawnPrompt: setupPromptFor(run.runId, ref),
    };
  },
  verify: (_run, result): VerifyResult => {
    if (result === null || typeof result !== "object") {
      return { ok: false, problems: ["D2a-setup: worker returned non-object result"] };
    }
    return { ok: true, problems: [] };
  },
};

/** Test-only export so distribute.test.ts can exercise d2aSetup directly. */
export const __d2aSetupForTests = d2aSetup;

/** Test-only exports for prompt-contract assertions. */
export const __setupPromptForTests = setupPromptFor;
export const __routePromptForTests = routePromptFor;

// ── D2b-route ────────────────────────────────────────────────────────────
//
// A fanout step that emits one worker per rowPlan across all 4 channels
// (Meta-paid, YouTube, Article, Meta-organic). Each unit's input is staged
// via ctx.stageInput (ADR-024) and fetched on entry via
// mcp__orchestrator__read_step_result. The staged payload carries the
// rowPlan, its matching backfill (if any), and the D2a setupContext
// (campaign + adset IDs) so the worker never has to look up D2a's output
// itself.

interface SetupResult {
  campaignId: string | null;
  adsetByCellId: Record<string, string>;
}

function emptySetup(): SetupResult {
  return { campaignId: null, adsetByCellId: {} };
}

type Channel = "Meta-paid" | "YouTube" | "Article" | "Meta-organic";

interface RouteUnit {
  channel: Channel;
  rowPlan: RowPlan;
  backfill: ToolStep | null;
}

/** Match a backfill to its rowPlan by matching the args.id (store.update target). */
function bfMatchesRow(backfill: ToolStep, rowPlan: RowPlan): boolean {
  const args = backfill.args as { id?: string };
  return args.id === rowPlan.rowId;
}

function unitsFromPart(channel: Channel, part: PlanPart): RouteUnit[] {
  return part.rowPlans.map((rp) => ({
    channel,
    rowPlan: rp,
    backfill: part.backfills.find((b) => bfMatchesRow(b, rp)) ?? null,
  }));
}

function makeChannelOk(filter: string[] | undefined): (channel: Channel) => boolean {
  if (!filter || filter.length === 0) return () => true;
  const set = new Set(filter);
  return (channel) => set.has(channel);
}

function routePromptFor(runId: string, ref: string, channel: Channel, unitIndex: number): string {
  return [
    `Run ${runId}: You are the ${channel} row-routing worker. Your job: execute one rowPlan`,
    "against the platform MCPs and persist the resulting row identifier.",
    "",
    "Your FIRST action: call",
    `  mcp__orchestrator__read_step_result({ stepResultId: "${ref}" })`,
    "to fetch your staged input { channel, rowPlan, backfill, setupContext,",
    "dryRun, runId }.",
    "",
    "Procedure:",
    "1. Idempotency pre-check — inspect the row in the store. If the channel's",
    "   identifier is already set (adId for Meta-paid, ytVideoId for YouTube,",
    "   fbPostId for Meta-organic, deliveredAt for Article), skip execution with",
    "   status: \"skipped\" and reason, and do NOT execute the plan.",
    "2. Execute rowPlan.steps in order. Each step has `captures` (label the",
    "   result) and `needs` (labels to substitute into args before invoking).",
    "   - For intra-row captures (asset:<variantId>, creative:<variantId>:<lang>,",
    "     ad:<variantId>:<lang>, yt:<variantId>, fb:<variantId>, article:<rowId>:<lang>),",
    "     substitute the previously captured result.",
    "   - For setup captures (\"campaign\" or \"adset:<cellId>\"), use",
    "     setupContext.campaignId or setupContext.adsetByCellId[cellId] directly —",
    "     no capture lookup needed for those.",
    "   - If a step has `poll`, call poll.tool until poll.untilField equals",
    "     poll.untilValue (give up after ~3 min) before continuing.",
    "3. If `backfill` is non-null, execute it, substituting `needs` and any",
    "   $-prefixed placeholders ($adIds, $ytVideoId, $fbPostId, $now) from",
    "   what you captured.",
    "4. If `dryRun` is true, do NOT execute any call — walk the plan and",
    "   report what you would have called.",
    "",
    "Build your result object: { rowId, channel, status: \"routed\" | \"skipped\" | \"failed\",",
    "outputJson?, errorMessage? }.",
    "Then, before your final message, call",
    `  mcp__orchestrator__write_step_result({ runId: "${runId}", stepId: "D2b-route", unitIndex: ${unitIndex}, payload: <your result object> })`,
    "and return ONLY { stepResultId } as your final message (ADR-022 claim-check).",
  ].join("\n");
}

const d2bRoute: StepSpec = {
  id: "D2b-route",
  kind: "fanout",
  build: async (run: RunState, ctx: BuildContext): Promise<Step> => {
    const d1 = stepResult<unknown[]>(run, "D1-query") ?? [];
    const cells = cellsOf(rowsOf(d1[2])[0]);
    const variants = projectVariants(rowsOf(d1[0]), cells);
    const articles = projectArticles(rowsOf(d1[1]));
    const setup = stepResult<SetupResult>(run, "D2a-setup") ?? emptySetup();
    const params = run.params as unknown as DistributeParams;
    const channelOk = makeChannelOk(params.channelFilter);
    // Manual mode: no Meta API fan-out — those ads are posted by hand from the
    // webapp pack (D3b records them as skipped: "manual posting pack").
    const metaApi = metaPaidMode() === "api";

    const rowUnits: RouteUnit[] = [
      ...(metaApi && channelOk("Meta-paid") ? unitsFromPart("Meta-paid", planMetaPaidRows(variants, cells)) : []),
      ...(channelOk("YouTube")      ? unitsFromPart("YouTube",      planYouTube(variants))             : []),
      ...(channelOk("Article")      ? unitsFromPart("Article",      planArticles(articles))            : []),
      ...(channelOk("Meta-organic") ? unitsFromPart("Meta-organic", planOrganic(variants))             : []),
    ];

    const units = await Promise.all(
      rowUnits.map(async (u, i) => {
        const ref = await ctx.stageInput(i, {
          channel: u.channel,
          rowPlan: u.rowPlan,
          backfill: u.backfill,
          setupContext: setup,
          dryRun: params.dryRun ?? false,
          runId: run.runId,
        });
        return { spawnPrompt: routePromptFor(run.runId, ref, u.channel, i) };
      }),
    );

    return { kind: "fanout", stepId: "D2b-route", worker: "general-purpose", units };
  },
  verify: (_run, result): VerifyResult => {
    if (!Array.isArray(result)) {
      return { ok: false, problems: ["D2b-route: fanout result not an array"] };
    }
    return { ok: true, problems: [] };
  },
};

/** Test-only export so distribute.test.ts can exercise d2bRoute directly. */
export const __d2bRouteForTests = d2bRoute;

// ── D3b-summary ──────────────────────────────────────────────────────────
//
// A write step that emits per-(variant × channel) and per-article
// Distributions audit rows after D3a's ground-truth re-query. The status of
// each row is derived from comparing D1's "expected" baseline against D3a's
// re-queried actual: if the channel's identifier is present on the actual
// row (adId for Meta-paid, ytVideoId for YouTube, fbPostId for Meta-organic,
// deliveredAt for Article), the row is "routed"; otherwise "failed".

type DistChannel = "Meta-paid" | "Meta-organic" | "YouTube" | "Article";

const RECOGNIZED_VARIANT_CHANNELS: ReadonlySet<string> = new Set([
  "Meta-paid",
  "Meta-organic",
  "YouTube",
  "YouTube-Shorts",
]);

/** Normalize a variant's raw channel string to a Distributions-row channel. */
function distChannelOf(rawChannel: string): DistChannel | null {
  if (rawChannel === "Meta-paid") return "Meta-paid";
  if (rawChannel === "Meta-organic") return "Meta-organic";
  if (rawChannel === "YouTube" || rawChannel === "YouTube-Shorts") return "YouTube";
  return null;
}

/** Did the actual variant land on this channel? Inspects the channel's GT field. */
function isVariantRouted(actual: DistVariant | undefined, channel: DistChannel): boolean {
  if (!actual) return false;
  if (channel === "Meta-paid") {
    return !!actual.adId && (!!actual.adId.en || !!actual.adId.ms);
  }
  if (channel === "YouTube") return !!actual.ytVideoId;
  if (channel === "Meta-organic") return !!actual.fbPostId;
  return false;
}

/** Short hex-ish id suffix for a friendly title. Falls back to the full id. */
function shortId(id: string): string {
  const dash = id.indexOf("-");
  if (dash > 0 && dash <= 8) return id.slice(0, dash);
  return id.length > 8 ? id.slice(0, 8) : id;
}

interface StoreCreateCall {
  tool: "mcp__store__create";
  args: {
    entity: "Distributions";
    props: {
      runId: string;
      targetEntity: "CreativeVariants" | "AuthorityArticles";
      targetId: string;
      channel: DistChannel;
      status: "routed" | "failed" | "skipped";
      authorStep: "D3-confirm";
      attempt: number;
      dryRun: boolean;
      title: string;
      createdBy: string;
      skipReason?: string;
    };
  };
}

/**
 * If we already knew at plan-time that this (variant × channel) couldn't be
 * routed — e.g. Meta-paid without an experiment cell, Carousel 4:5 organic,
 * organic without a schedule — return the skip reason so D3b records it as
 * `status: "skipped"` rather than the more pessimistic `status: "failed"`.
 * Keeps the audit log honest: failed ≠ never-attempted.
 */
function plannerSkipReason(exp: DistVariant, channel: DistChannel): string | null {
  if (channel === "Meta-paid") {
    if (metaPaidMode() === "manual") return "manual posting pack";
    if (!exp.metaSpec) return "Meta spec missing — re-run /produce";
    if (!exp.cellId) return "not assigned to an experiment cell";
  }
  if (channel === "YouTube") {
    if (!exp.ytSpec) return "YouTube spec missing — re-run /produce";
  }
  if (channel === "Meta-organic") {
    if (exp.format === "Carousel" && exp.aspect === "4:5") {
      return "Carousel 4:5 excluded from organic FB — IG portrait layout (E-025)";
    }
    if (!exp.organicScheduledFor) return "Organic Scheduled For not set — run schedule first";
  }
  return null;
}

function buildSummaryCalls(
  runId: string,
  expectedV: DistVariant[],
  expectedA: DistArticle[],
  actualV: DistVariant[],
  actualA: DistArticle[],
): StoreCreateCall[] {
  const actualVMap = new Map(actualV.map((v) => [v.rowId, v]));
  const actualAMap = new Map(actualA.map((a) => [a.rowId, a]));
  const calls: StoreCreateCall[] = [];

  for (const exp of expectedV) {
    for (const raw of exp.channels) {
      if (!RECOGNIZED_VARIANT_CHANNELS.has(raw)) continue;
      const channel = distChannelOf(raw);
      if (!channel) continue;
      const actual = actualVMap.get(exp.rowId);
      const skipReason = isVariantRouted(actual, channel) ? null : plannerSkipReason(exp, channel);
      const status: "routed" | "failed" | "skipped" = isVariantRouted(actual, channel)
        ? "routed"
        : skipReason
          ? "skipped"
          : "failed";
      calls.push({
        tool: "mcp__store__create",
        args: {
          entity: "Distributions",
          props: {
            runId,
            targetEntity: "CreativeVariants",
            targetId: exp.rowId,
            channel,
            status,
            authorStep: "D3-confirm",
            attempt: 1,
            dryRun: false,
            title: `${channel} · Variant ${shortId(exp.rowId)}`,
            createdBy: "XOS",
            ...(skipReason ? { skipReason } : {}),
          },
        },
      });
    }
  }

  for (const exp of expectedA) {
    const actual = actualAMap.get(exp.rowId);
    const status = actual && actual.deliveredAt ? "routed" : "failed";
    calls.push({
      tool: "mcp__store__create",
      args: {
        entity: "Distributions",
        props: {
          runId,
          targetEntity: "AuthorityArticles",
          targetId: exp.rowId,
          channel: "Article",
          status,
          authorStep: "D3-confirm",
          attempt: 1,
          dryRun: false,
          title: `Article · ${shortId(exp.rowId)}`,
          createdBy: "XOS",
        },
      },
    });
  }

  return calls;
}

const d3bSummary: StepSpec = {
  id: "D3b-summary",
  kind: "write",
  build: (run): Step => {
    const d1 = stepResult<unknown[]>(run, "D1-query") ?? [];
    const d3a = stepResult<unknown[]>(run, "D3a-confirm") ?? [];
    const cells = cellsOf(rowsOf(d1[2])[0]);
    const expectedV = projectVariants(rowsOf(d1[0]), cells);
    const expectedA = projectArticles(rowsOf(d1[1]));
    const actualV = projectVariants(rowsOf(d3a[0]), cells);
    const actualA = projectArticles(rowsOf(d3a[1]));
    const calls = buildSummaryCalls(run.runId, expectedV, expectedA, actualV, actualA);
    return { kind: "write", stepId: "D3b-summary", calls };
  },
  verify: (run, _result): VerifyResult => {
    // Re-derive expected vs. actual from D1 + D3a, then delegate to
    // verifyDistribute. We don't read this step's own result — the audit
    // rows are intentionally best-effort and a missed Distributions row
    // shouldn't halt the loop. But a real distribution failure (an approved
    // variant that didn't land AND wasn't a known plan-time skip) must
    // halt the run before the stage completes.
    const d1 = stepResult<unknown[]>(run, "D1-query") ?? [];
    const d3a = stepResult<unknown[]>(run, "D3a-confirm") ?? [];
    const cells = cellsOf(rowsOf(d1[2])[0]);
    const expectedV = projectVariants(rowsOf(d1[0]), cells);
    const expectedA = projectArticles(rowsOf(d1[1]));
    const actualV = projectVariants(rowsOf(d3a[0]), cells);
    const actualA = projectArticles(rowsOf(d3a[1]));

    // Filter out expected (variant × channel) pairs that the planner knew
    // it couldn't route — those are "skipped", not "failed", and shouldn't
    // count against verifyDistribute's pass criterion.
    const filtered = expectedV.map((v) => {
      const routableChannels = v.channels.filter((raw) => {
        const ch = distChannelOf(raw);
        return ch ? plannerSkipReason(v, ch) === null : true;
      });
      return { ...v, channels: routableChannels };
    });

    return verifyDistribute(filtered, expectedA, actualV, actualA);
  },
};

/** Test-only export so distribute.test.ts can exercise d3bSummary directly. */
export const __d3bSummaryForTests = d3bSummary;

export const distributeStage: StageDefinition = {
  id: "distribute",
  steps: [d1Query, d2aSetup, d2bRoute, d3aConfirm, d3bSummary],
};

/** Test-only export so distribute.test.ts can exercise d3aConfirm directly. */
export const __d3aConfirmForTests = d3aConfirm;
