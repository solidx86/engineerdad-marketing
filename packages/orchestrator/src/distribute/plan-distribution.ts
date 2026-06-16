import { youtubeCategoryId } from "@engineerdad/shared/derive";
import type { AllocatedCell } from "../experiment/allocation.js";

/**
 * planDistribution — the pure routing planner. Given the run's approved rows,
 * it produces a DistributionPlan: an ordered set of MCP calls the distribute
 * worker executes. It encodes every routing DECISION (channel branching,
 * naming conventions, idempotency gates, gap detection) but derives no copy —
 * spec fields are read verbatim onto ToolStep.args. Runtime values
 * (campaign_id, adset_id, …) are not literals: a producing step `captures`
 * them and a consuming step `needs` them; the worker substitutes.
 *
 * Meta-paid, YouTube, articles, and organic-FB.
 */

export interface MetaSpec {
  primaryTextEn: string;
  primaryTextMs: string;
  headlineEn: string;
  headlineMs: string;
  descriptionEn: string;
  descriptionMs: string;
  ctaType: string;
  targetingJson: string;
}

export interface YtSpec {
  title: string;
  description: string;
  tags: string[];
  category: string;
}

export interface DistVariant {
  rowId: string;
  variantId: string;
  format: string;
  aspect: string;
  channels: string[];
  assetFiles: { url: string }[];
  adId: { en: string | null; ms: string | null } | null;
  ytVideoId: string | null;
  metaSpec: MetaSpec | null;
  ytSpec: YtSpec | null;
  cellId: string | null;
  // Organic-FB routing (planOrganic). `organicScheduledFor` is stamped by the
  // schedule stage; `fbPostId` is the idempotency back-fill.
  fbPostId: string | null;
  organicScheduledFor: string | null;
  organicCaption: string | null;
  organicLang: string | null;
}

export interface DistArticle {
  rowId: string;
  slug: string;
  // Bilingual title — engineerdad-site requires it per lang.
  titleEn: string | null;
  titleMs: string | null;
  // Single-language fields shared across en/ms drafts. The site MCP allows
  // these to differ per lang in principle, but the AuthorityArticles row
  // models them as single fields today.
  description: string | null;
  topicTag: string | null;
  readingTime: string | null;
  keywords: string[];
  ogImageUrl: string | null;
  // YYYY-MM-DD. If null, planArticles falls back to today's date.
  datePublished: string | null;
  // Optional but useful to pass through.
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  bodyEn: string | null;
  bodyMs: string | null;
  faqEn: string | null;
  faqMs: string | null;
  deliveredAt: string | null;
}

export interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  /** Label for this call's result, referenced by a later step's `needs`. */
  captures?: string;
  /** Captures the worker must substitute into this call's args before running it. */
  needs?: string[];
  /** Poll this read-tool until untilField === untilValue before continuing. */
  poll?: { tool: string; untilField: string; untilValue: string };
}

export interface RowPlan {
  rowId: string;
  channel: string;
  action: "route";
  steps: ToolStep[];
}

export interface Skip {
  rowId: string;
  reason: string;
}

export interface DistributionPlan {
  runId: string;
  setup: ToolStep[];
  rowPlans: RowPlan[];
  backfills: ToolStep[];
  skipped: Skip[];
  notes: string[];
  dryRun: boolean;
}

export interface PlanPart {
  setup: ToolStep[];
  rowPlans: RowPlan[];
  backfills: ToolStep[];
  skipped: Skip[];
  notes: string[];
}

const META = "Meta-paid";
const ORGANIC = "Meta-organic";
const VIDEO_FORMATS = new Set(["Reel", "YT-Long", "YT-Short"]);

function emptyPart(): PlanPart {
  return { setup: [], rowPlans: [], backfills: [], skipped: [], notes: [] };
}

function mergeParts(parts: PlanPart[]): PlanPart {
  return {
    setup: parts.flatMap((p) => p.setup),
    rowPlans: parts.flatMap((p) => p.rowPlans),
    backfills: parts.flatMap((p) => p.backfills),
    skipped: parts.flatMap((p) => p.skipped),
    notes: parts.flatMap((p) => p.notes),
  };
}

/**
 * Meta locale IDs (integers from Meta's Graph API).
 * Source: scripts/lookup-meta-locale-ids.mjs, retrieved 2026-05-29.
 *   en (English (US)) = 6
 *   ms (Malay)        = 41
 * Re-run the script if Meta ever changes their adlocale catalogue.
 */
export const LOCALE_ID = { en: 6, ms: 41 } as const;

export interface MetaTargeting {
  geo_locations: { countries: string[] };
  age_min: number;
  age_max: number;
  locales: number[];
  targeting_automation: { advantage_audience: 0 | 1 };
}

/**
 * Minimum broad targeting per Andromeda doctrine (creative-as-targeting).
 * One adset per cell, bilingual ads attached → both locales on every adset.
 * The `_cell` parameter is unused today but kept in the signature: future
 * cell-aware targeting (E-042 persona-as-experimental-factor) reads it.
 *
 * Spec: docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html §3.3.3
 */
export function targetingForCell(_cell: AllocatedCell): MetaTargeting {
  return {
    geo_locations: { countries: ["MY"] },
    age_min: 25,
    age_max: 55,
    locales: [LOCALE_ID.en, LOCALE_ID.ms],
    targeting_automation: { advantage_audience: 0 },
  };
}

// ── Meta-paid ────────────────────────────────────────────────────────────

export const CAMPAIGN_OBJECTIVE = "OUTCOME_LEADS" as const;

/** daily_budget_cents = MYR × allocationPct (percent units → cents), floored at 1. */
export function dailyBudgetCentsFor(cell: AllocatedCell, dailyBudgetMyr: number): number {
  return Math.max(1, Math.round(dailyBudgetMyr * cell.allocationPct));
}

function campaignStep(runId: string): ToolStep {
  return {
    tool: "mcp__meta-ads__create_campaign",
    args: { name: `EDOS_${runId}`, objective: CAMPAIGN_OBJECTIVE, client_request_id: runId },
    captures: "campaign",
  };
}

export function adsetStep(runId: string, cell: AllocatedCell, dailyBudgetMyr: number): ToolStep {
  return {
    tool: "mcp__meta-ads__create_adset",
    args: {
      name: `${runId}__${cell.cellId}`,
      // daily_budget_cents = MYR × allocationPct(0-100) = MYR-cents.
      // allocationPct is in percent units (see experiment/allocation.ts —
      // BASE_SHARE uses 70/20/10 and per-cell allocs sum to 100), so the
      // product is already in cents — no ×100 needed.
      // Floor at 1 so a zero/tiny-allocation cell still produces a legal
      // Meta call (the API rejects daily_budget < 1 with exclusiveMinimum:0);
      // the operator sees the absurd amount in Ads Manager and corrects.
      daily_budget_cents: dailyBudgetCentsFor(cell, dailyBudgetMyr),
      optimization_goal: "LEAD_GENERATION",
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: targetingForCell(cell),
      client_request_id: `${runId}::${cell.cellId}`,
    },
    captures: `adset:${cell.cellId}`,
    needs: ["campaign"],
  };
}

function uploadStep(v: DistVariant): ToolStep {
  const isVideo = VIDEO_FORMATS.has(v.format);
  const step: ToolStep = {
    tool: isVideo ? "mcp__meta-ads__upload_video" : "mcp__meta-ads__upload_image",
    args: { name: `var_${v.variantId}`, file_url: v.assetFiles[0]?.url ?? "" },
    captures: `asset:${v.variantId}`,
  };
  if (isVideo) {
    step.poll = {
      tool: "mcp__meta-ads__get_entity_status",
      untilField: "status",
      untilValue: "READY",
    };
  }
  return step;
}

/** Test-only export so plan-distribution.test.ts can lock the creative contract. */
export const __creativeStepForTests = creativeStep;

function creativeStep(v: DistVariant, lang: "en" | "ms", spec: MetaSpec): ToolStep {
  return {
    tool: "mcp__meta-ads__create_ad_creative",
    args: {
      name: `var_${v.variantId}_${lang}_creative`,
      primary_text: lang === "en" ? spec.primaryTextEn : spec.primaryTextMs,
      headline: lang === "en" ? spec.headlineEn : spec.headlineMs,
      description: lang === "en" ? spec.descriptionEn : spec.descriptionMs,
      call_to_action: spec.ctaType,
      lang,
    },
    captures: `creative:${v.variantId}:${lang}`,
    needs: [`asset:${v.variantId}`],
  };
}

function adStep(v: DistVariant, lang: "en" | "ms", cellId: string): ToolStep {
  return {
    tool: "mcp__meta-ads__create_ad",
    args: { name: `var_${v.variantId}_${lang}`, client_request_id: `${v.variantId}::${lang}` },
    captures: `ad:${v.variantId}:${lang}`,
    needs: [`adset:${cellId}`, `creative:${v.variantId}:${lang}`],
  };
}

function metaBackfill(v: DistVariant): ToolStep {
  return {
    tool: "mcp__store__update",
    args: { entity: "CreativeVariants", id: v.rowId, props: { adId: "$adIds" } },
    needs: [`ad:${v.variantId}:en`, `ad:${v.variantId}:ms`],
  };
}

/**
 * Filter Meta variants down to those that are actually routable (have a
 * metaSpec, a cellId, and don't already carry an adId). Skipped variants are
 * not returned here — the per-stage helpers (`planMetaPaidSetup`,
 * `planMetaPaidRows`) re-derive the same filter and record their own
 * notes/skipped, scoped to the concerns they own. Keeping this helper
 * read-only keeps the two stages cleanly separable.
 */
function routableMetaVariants(variants: DistVariant[]): DistVariant[] {
  const routable: DistVariant[] = [];
  for (const v of variants.filter((x) => x.channels.includes(META))) {
    if (v.adId && v.adId.en && v.adId.ms) continue;
    if (!v.metaSpec) continue;
    if (!v.cellId) continue;
    routable.push(v);
  }
  return routable;
}

/**
 * D2a — Meta paid setup. Emits the campaign step and one adset step per
 * distinct cell referenced by a routable variant. Cells referenced by routable
 * variants but absent from `cells` get a `notes` entry (no adset emitted).
 * `rowPlans`/`backfills` are left empty; row emission lives in
 * `planMetaPaidRows`.
 */
export function planMetaPaidSetup(
  runId: string,
  variants: DistVariant[],
  cells: AllocatedCell[],
  dailyBudgetMyr: number,
): PlanPart {
  const part = emptyPart();
  const routable = routableMetaVariants(variants);
  if (routable.length === 0) return part;

  part.setup.push(campaignStep(runId));
  const cellById = new Map(cells.map((c) => [c.cellId, c]));
  const validCells = new Set<string>();
  for (const v of routable) {
    const cellId = v.cellId!;
    if (validCells.has(cellId)) continue;
    const cell = cellById.get(cellId);
    if (!cell) {
      part.notes.push(`cell ${cellId} not in the experiment design`);
      continue;
    }
    validCells.add(cellId);
    part.setup.push(adsetStep(runId, cell, dailyBudgetMyr));
  }
  return part;
}

/**
 * D2b — Meta paid rows. Emits the upload/creative/ad chain + backfill for each
 * routable Meta variant whose cell is in the design. Per-variant skips
 * (adId-set, no metaSpec, no cellId, bad cellId) record `skipped` entries with
 * the same reason strings the monolithic planner used. No `setup` emitted —
 * that belongs to D2a.
 */
export function planMetaPaidRows(
  variants: DistVariant[],
  cells: AllocatedCell[],
): PlanPart {
  const part = emptyPart();
  const metaVariants = variants.filter((v) => v.channels.includes(META));
  const validCells = new Set(cells.map((c) => c.cellId));

  for (const v of metaVariants) {
    if (v.adId && v.adId.en && v.adId.ms) {
      part.skipped.push({ rowId: v.rowId, reason: "Ad ID already populated" });
      continue;
    }
    if (!v.metaSpec) {
      part.skipped.push({ rowId: v.rowId, reason: "Meta spec missing — re-run /produce" });
      part.notes.push(`${v.rowId}: Meta spec missing`);
      continue;
    }
    if (!v.cellId) {
      part.skipped.push({ rowId: v.rowId, reason: "not assigned to an experiment cell" });
      part.notes.push(`${v.rowId}: no experiment cell`);
      continue;
    }
    const cellId = v.cellId;
    if (!validCells.has(cellId)) {
      part.skipped.push({ rowId: v.rowId, reason: `cell ${cellId} not in the experiment design` });
      continue;
    }
    const spec = v.metaSpec;
    part.rowPlans.push({
      rowId: v.rowId,
      channel: META,
      action: "route",
      steps: [
        uploadStep(v),
        creativeStep(v, "en", spec),
        creativeStep(v, "ms", spec),
        adStep(v, "en", cellId),
        adStep(v, "ms", cellId),
      ],
    });
    part.backfills.push(metaBackfill(v));
  }
  return part;
}

export function planMetaPaid(
  runId: string,
  variants: DistVariant[],
  cells: AllocatedCell[],
  dailyBudgetMyr: number,
): PlanPart {
  return mergeParts([
    planMetaPaidSetup(runId, variants, cells, dailyBudgetMyr),
    planMetaPaidRows(variants, cells),
  ]);
}

// ── YouTube ──────────────────────────────────────────────────────────────

const YT_CHANNELS = ["YouTube", "YouTube-Shorts"];

export function planYouTube(variants: DistVariant[]): PlanPart {
  const part = emptyPart();
  const ytVariants = variants.filter((v) => v.channels.some((c) => YT_CHANNELS.includes(c)));
  for (const v of ytVariants) {
    if (v.ytVideoId) {
      part.skipped.push({ rowId: v.rowId, reason: "YT Video ID already populated" });
    } else if (!v.ytSpec) {
      part.skipped.push({ rowId: v.rowId, reason: "YouTube spec missing — re-run /produce" });
      part.notes.push(`${v.rowId}: YouTube spec missing`);
    } else {
      const spec = v.ytSpec;
      part.rowPlans.push({
        rowId: v.rowId,
        channel: "YouTube",
        action: "route",
        steps: [
          {
            tool: "mcp__youtube__upload_video",
            args: {
              file_url: v.assetFiles[0]?.url ?? "",
              title: spec.title,
              description: spec.description,
              tags: spec.tags,
              category_id: youtubeCategoryId(spec.category),
            },
            captures: `yt:${v.variantId}`,
          },
        ],
      });
      part.backfills.push({
        tool: "mcp__store__update",
        args: {
          entity: "CreativeVariants",
          id: v.rowId,
          props: { ytVideoId: "$ytVideoId" },
        },
        needs: [`yt:${v.variantId}`],
      });
    }
  }
  return part;
}

// ── Articles (engineerdad-site) ──────────────────────────────────────────

/** Today as ISO YYYY-MM-DD, the date_published fallback. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the full draft_article arg set for one language. Skips required-field
 * checks here — `planArticles` does the gating before calling this.
 */
function articleArgsFor(a: DistArticle, lang: "en" | "ms"): Record<string, unknown> {
  const title = lang === "en" ? a.titleEn : a.titleMs;
  const args: Record<string, unknown> = {
    slug: a.slug,
    lang,
    title: title!,
    description: a.description!,
    topic_tag: a.topicTag!,
    reading_time: a.readingTime!,
    keywords: a.keywords,
    brief_markdown: (lang === "en" ? a.bodyEn : a.bodyMs)!,
    faq_markdown: (lang === "en" ? a.faqEn : a.faqMs)!,
    og_image: a.ogImageUrl!,
    date_published: a.datePublished ?? todayIso(),
  };
  if (a.heroImageUrl) args.hero_image_url = a.heroImageUrl;
  if (a.heroImageAlt) args.hero_image_alt = a.heroImageAlt;
  return args;
}

/**
 * Return the first missing field for a draft_article call in this lang, or
 * null if all required fields are present.
 */
function articleMissingField(a: DistArticle, lang: "en" | "ms"): string | null {
  const body = lang === "en" ? a.bodyEn : a.bodyMs;
  const faq = lang === "en" ? a.faqEn : a.faqMs;
  const title = lang === "en" ? a.titleEn : a.titleMs;
  if (!body) return "body";
  if (!faq) return "faq";
  if (!title) return "title";
  if (!a.description) return "description";
  if (!a.topicTag) return "topic_tag";
  if (!a.readingTime) return "reading_time";
  if (!a.keywords || a.keywords.length === 0) return "keywords";
  if (!a.ogImageUrl) return "og_image";
  return null;
}

export function planArticles(articles: DistArticle[]): PlanPart {
  const part = emptyPart();
  for (const a of articles) {
    if (a.deliveredAt) continue; // already delivered — idempotency gate
    const steps: ToolStep[] = [];

    const missEn = articleMissingField(a, "en");
    if (missEn === null) {
      steps.push({
        tool: "mcp__engineerdad_site__draft_article",
        args: articleArgsFor(a, "en"),
        captures: `article:${a.rowId}:en`,
      });
    } else {
      part.notes.push(`${a.rowId}: EN skipped — ${missEn} missing`);
    }

    const missMs = articleMissingField(a, "ms");
    if (missMs === null) {
      steps.push({
        tool: "mcp__engineerdad_site__draft_article",
        args: articleArgsFor(a, "ms"),
        captures: `article:${a.rowId}:ms`,
      });
    } else {
      part.notes.push(`${a.rowId}: MS skipped — ${missMs} missing`);
    }

    if (steps.length === 0) {
      part.skipped.push({ rowId: a.rowId, reason: "no deliverable language" });
      continue;
    }
    part.rowPlans.push({ rowId: a.rowId, channel: "engineerdad-site", action: "route", steps });
    part.backfills.push({
      tool: "mcp__store__update",
      args: { entity: "AuthorityArticles", id: a.rowId, props: { deliveredAt: "$now" } },
    });
  }
  return part;
}

// ── Organic FB (meta-organic) ────────────────────────────────────────────

function epochSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** The meta-organic publish call for a variant — FB only (B-005: IG manual). */
function organicPublishStep(v: DistVariant): ToolStep {
  const base = {
    variantId: v.variantId,
    platform: "fb",
    caption: v.organicCaption ?? "",
    lang: v.organicLang ?? "en",
    scheduledPublishTime: epochSeconds(v.organicScheduledFor!),
  };
  const captures = `fb:${v.variantId}`;
  if (v.format === "Carousel") {
    return {
      tool: "mcp__meta-organic__publish_carousel_post",
      args: { ...base, imageUrls: v.assetFiles.map((f) => f.url) },
      captures,
    };
  }
  if (VIDEO_FORMATS.has(v.format)) {
    return {
      tool: "mcp__meta-organic__publish_video_post",
      args: { ...base, videoUrl: v.assetFiles[0]?.url ?? "" },
      captures,
    };
  }
  return {
    tool: "mcp__meta-organic__publish_image_post",
    args: { ...base, imageUrl: v.assetFiles[0]?.url ?? "" },
    captures,
  };
}

export function planOrganic(variants: DistVariant[]): PlanPart {
  const part = emptyPart();
  for (const v of variants.filter((x) => x.channels.includes(ORGANIC))) {
    if (v.fbPostId) {
      part.skipped.push({ rowId: v.rowId, reason: "FB Post ID already populated" });
    } else if (v.format === "Carousel" && v.aspect === "4:5") {
      part.skipped.push({
        rowId: v.rowId,
        reason: "Carousel 4:5 excluded from organic FB — IG portrait layout (E-025)",
      });
    } else if (!v.organicScheduledFor) {
      part.skipped.push({
        rowId: v.rowId,
        reason: "Organic Scheduled For not set — run schedule first",
      });
      part.notes.push(`${v.rowId}: organic post not scheduled`);
    } else {
      part.rowPlans.push({
        rowId: v.rowId,
        channel: ORGANIC,
        action: "route",
        steps: [organicPublishStep(v)],
      });
      part.backfills.push({
        tool: "mcp__store__update",
        args: {
          entity: "CreativeVariants",
          id: v.rowId,
          props: { fbPostId: "$fbPostId" },
        },
        needs: [`fb:${v.variantId}`],
      });
    }
  }
  return part;
}

// ── Entry point ──────────────────────────────────────────────────────────

export function planDistribution(
  runId: string,
  variants: DistVariant[],
  articles: DistArticle[],
  cells: AllocatedCell[],
  opts: { channelFilter?: string[]; dryRun?: boolean; dailyBudgetMyr?: number } = {},
): DistributionPlan {
  const dryRun = opts.dryRun ?? false;
  const dailyBudgetMyr = opts.dailyBudgetMyr ?? 0;
  const channelAllowed = (ch: string): boolean =>
    !opts.channelFilter || opts.channelFilter.length === 0 || opts.channelFilter.includes(ch);

  const parts: PlanPart[] = [];
  if (channelAllowed(META)) {
    parts.push(planMetaPaid(runId, variants, cells, dailyBudgetMyr));
  }
  if (channelAllowed("YouTube")) {
    parts.push(planYouTube(variants));
  }
  if (channelAllowed("engineerdad-site")) {
    parts.push(planArticles(articles));
  }
  if (channelAllowed(ORGANIC)) {
    parts.push(planOrganic(variants));
  }

  const merged = mergeParts(parts);
  return { runId, ...merged, dryRun };
}
