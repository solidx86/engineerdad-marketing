import { pgTable, text, integer, real, jsonb, uuid, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enum value lists (canonical for Postgres store; supersedes the Notion-bootstrap vocab) ──
//   Membership is NOT enforced by the DB (text columns, no CHECK constraint) and there is
//   no CRUD-layer validator today — producers are expected to constrain themselves to
//   these values. The arrays are exported for use by callers that want to do their own
//   membership checks (e.g. the webapp's typed form helpers).
//   Several enums diverge from packages/notion-bootstrap/src/schemas.ts intentionally
//   (CHANNELS, META_CTA_TYPE, ORGANIC_LANGUAGE casing, HYPOTHESIS_STATUS, DOMAIN, LEARNING_*).
//   See TASKS.md "E-029-followup: audit downstream emitters for enum-value drift".

export const APPROVAL_STATUS = [
  "Draft", "Awaiting Approval", "Approved", "Rejected",
  "Published", "Generation Failed — Review",
] as const;

export const CREATED_BY = [
  "Brain", "Targeting", "ContentGen", "MediaProd",
  "XOS", "Tracking", "Analytics", "Human",
] as const;

export const PERSONA = [
  "engineer_dad_archetype", "young_parents_25_35", "established_parents_35_45",
  "single_income_conservative", "dual_income_growth", "pre_retirement_prs_focus",
  "business_owner_self_employed", "salaried_professional_top_up",
] as const;

export const SCRIPT_FORMAT = ["Reel", "Feed", "Carousel", "YT-Long", "YT-Short"] as const;
export const ASPECT = ["9:16", "1:1", "16:9", "4:5"] as const;
export const PROOF_TYPE = ["data", "testimonial", "case_study", "screenshot"] as const;
export const FUNNEL_STAGE = ["TOFU", "MOFU", "BOFU"] as const;
export const BUDGET_BUCKET = ["70", "20", "10"] as const;
export const AEO_SCHEMA = ["FAQ", "HowTo", "Article"] as const;
export const ARTICLE_CHANNEL = ["Blog", "Medium", "LinkedIn", "YouTube-description"] as const;
export const PRIMARY_METRIC = ["cpa", "hook_rate", "thumbstop", "ctr"] as const;
export const EXPERIMENT_LIFECYCLE_STATUS = ["Designed", "Running", "Concluded"] as const;
export const TEST_TYPE = ["factorial", "single-ad"] as const;
export const LAUNCH_WINDOW = ["24h", "7d", "open"] as const;
export const CHANNELS = [
  "Meta-paid", "YT", "Blog", "Medium", "LinkedIn", "IG-organic", "FB-organic",
] as const;
export const META_CTA_TYPE = [
  "LEARN_MORE", "DOWNLOAD", "SIGN_UP", "GET_QUOTE", "BOOK_TRAVEL", "CONTACT_US",
] as const;
export const YT_CATEGORY = [
  "Education", "People & Blogs", "Howto & Style", "Entertainment", "News & Politics",
] as const;
export const ORGANIC_LANGUAGE = ["en", "ms"] as const;
export const ORGANIC_STATUS = ["Draft", "Awaiting Approval", "Approved", "Posted", "Rejected"] as const;
export const PERF_WINDOW = ["7d", "14d", "30d"] as const;
export const HYPOTHESIS_STATUS = ["Pending", "Confirmed", "Refuted", "Inconclusive"] as const;
export const DOMAIN = ["copy", "creative", "audience", "offer", "media", "channel"] as const;
export const HYPOTHESIS_CHANNEL = ["paid", "organic", "both"] as const;
export const LEARNING_CONFIDENCE = ["Low", "Medium", "High"] as const;
export const LEARNING_STATUS = ["Active", "Aging", "Stale"] as const;

// ── Distributions-specific enums ─────────────────────────────────────────
export const DISTRIBUTION_TARGET_ENTITY = ["CreativeVariants", "AuthorityArticles"] as const;
export const DISTRIBUTION_CHANNEL = ["Meta-paid", "Meta-organic", "YouTube", "Article"] as const;
export const DISTRIBUTION_STATUS = ["routed", "failed", "skipped", "dry-run"] as const;
export const DISTRIBUTION_AUTHOR_STEP = ["D2b-route", "D3-confirm"] as const;

// ── Reel render-state enum (per 2026-05-28-heygen-reel-pipeline-design) ──
//   Lifecycle of a Reel CreativeVariant through the produce stage. `null`
//   render_state on a row means either a static-renderer format (Feed,
//   Carousel) or a Reel that hasn't started rendering yet — both are valid
//   and intentionally not represented here.
export const RENDER_STATE = [
  "HeygenGenerating",
  "HeygenCompleted",
  "Uploaded",
  "RenderFailed",
] as const;

// ── Helper: base columns every entity shares ─────────────────────────────

const baseColumns = () => ({
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  titleBm: text("title_bm"),
  approvalStatus: text("approval_status").notNull().default("Draft"),
  approver: text("approver"),
  createdBy: text("created_by").notNull(),
  runId: text("run_id").notNull(),
  complianceCheck: boolean("compliance_check").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Entity tables ────────────────────────────────────────────────────────

export const briefs = pgTable("briefs", {
  ...baseColumns(),
  persona: text("persona"),
  angle: text("angle").notNull(),
  promise: text("promise"),
  proofType: jsonb("proof_type").$type<string[]>(),
  funnelStage: text("funnel_stage"),
  bodyEn: text("body_en"),
  bodyBm: text("body_bm"),
  sourceInsights: text("source_insights"),
  budgetBucket: text("budget_bucket"),
  linkedHypotheses: jsonb("linked_hypotheses").$type<string[]>(),
});

/** One claim↔data binding (ADR-030). The authoritative shape lives in the
 *  zod ClaimBindingSchema (packages/shared); this row type mirrors it for the
 *  persistence layer. `data` ⇒ chartRef set + figures trace; `gap` ⇒ held,
 *  gapNote set, chartRef null; `qualitative` ⇒ no chart. */
export interface ClaimBindingRow {
  claim: string;
  kind: "data" | "qualitative" | "gap";
  chartRef: string | null;
  figures: string[];
  takeaway: string;
  gapNote: string | null;
}

export const scripts = pgTable("scripts", {
  ...baseColumns(),
  brief: text("brief"),                                          // FK → briefs.id
  format: text("format"),
  funnelStage: text("funnel_stage"),
  proofRefs: jsonb("proof_refs").$type<string[]>(),
  hookEn: text("hook_en"),
  hookBm: text("hook_bm"),
  scriptEn: text("script_en"),
  scriptBm: text("script_bm"),
  durationSec: integer("duration_sec"),
  ctaEn: text("cta_en"),
  ctaBm: text("cta_bm"),
  // ADR-030 data-first claim binding — authored at content-writer, reviewed at
  // HG2, executed (never invented) by creative-director, enforced by verifiers.
  claimBindings: jsonb("claim_bindings").$type<ClaimBindingRow[]>().default([]).notNull(),
});

export const authorityArticles = pgTable("authority_articles", {
  ...baseColumns(),
  topic: text("topic"),
  targetQuery: text("target_query"),
  bodyEn: text("body_en"),
  bodyBm: text("body_bm"),
  faqEn: text("faq_en"),
  faqBm: text("faq_bm"),
  citations: text("citations"),
  aeoSchema: text("aeo_schema"),
  targetChannels: jsonb("target_channels").$type<string[]>(),
  slug: text("slug"),
  description: text("description"),
  readingTime: text("reading_time"),
  keywords: jsonb("keywords").$type<string[]>(),
  ogImageUrl: text("og_image_url"),
  heroImageUrl: text("hero_image_url"),
  heroImageAlt: text("hero_image_alt"),
  relatedSlugs: jsonb("related_slugs").$type<string[]>(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveredTo: text("delivered_to"),
  prUrlEn: text("pr_url_en"),
  prUrlBm: text("pr_url_bm"),
  topicTag: text("topic_tag"),
});

export const creativeVariants = pgTable("creative_variants", {
  ...baseColumns(),
  script: text("script"),                                        // FK → scripts.id
  format: text("format"),
  aspect: text("aspect"),
  shotlistEn: text("shotlist_en"),
  shotlistBm: text("shotlist_bm"),
  thumbnailBrief: text("thumbnail_brief"),
  estimatedCostMyr: real("estimated_cost_myr"),
  assetFiles: jsonb("asset_files").$type<{ url: string; sha256: string }[]>(),
  imageGenerationNotes: text("image_generation_notes"),
  adId: text("ad_id"),
  channels: jsonb("channels").$type<string[]>(),
  ytTitle: text("yt_title"),
  ytDescription: text("yt_description"),
  ytTags: jsonb("yt_tags").$type<string[]>(),
  ytCategory: text("yt_category"),
  ytVideoId: text("yt_video_id"),
  metaPrimaryTextEn: text("meta_primary_text_en"),
  metaPrimaryTextBm: text("meta_primary_text_bm"),
  metaHeadlineEn: text("meta_headline_en"),
  metaHeadlineBm: text("meta_headline_bm"),
  metaDescriptionEn: text("meta_description_en"),
  metaDescriptionBm: text("meta_description_bm"),
  metaCtaType: text("meta_cta_type"),
  metaTargetingJson: text("meta_targeting_json"),
  organicLanguage: text("organic_language"),
  organicCaptionEn: text("organic_caption_en"),
  organicCaptionBm: text("organic_caption_bm"),
  organicHashtagsIg: jsonb("organic_hashtags_ig").$type<string[]>(),
  organicHashtagsFb: jsonb("organic_hashtags_fb").$type<string[]>(),
  organicStatus: text("organic_status"),
  organicScheduledFor: timestamp("organic_scheduled_for", { withTimezone: true }),
  organicApprovalNotes: text("organic_approval_notes"),
  pipelineNotes: text("pipeline_notes"),
  reelHeygenJobId: text("reel_heygen_job_id"),                  // persisted BEFORE polling — orphan recovery (exec.ts:92 scar)
  renderState: text("render_state"),                            // see RENDER_STATE enum; null for static formats
  renderStartedAt: timestamp("render_started_at", { withTimezone: true }),
  igPostId: text("ig_post_id"),
  fbPostId: text("fb_post_id"),
  organicPublishedAt: timestamp("organic_published_at", { withTimezone: true }),
});

export const experiments = pgTable("experiments", {
  ...baseColumns(),
  hypothesis: text("hypothesis"),
  factors: text("factors"),
  cells: text("cells"),
  primaryMetric: text("primary_metric"),
  dailyBudgetMyr: real("daily_budget_myr"),
  durationDays: integer("duration_days"),
  experimentStatus: text("experiment_status").notNull(),
  status: text("status"),
  testType: text("test_type"),
  launchWindow: text("launch_window"),
  readout: text("readout"),
  linkedVariants: jsonb("linked_variants").$type<string[]>(),
});

export const performanceReports = pgTable("performance_reports", {
  ...baseColumns(),
  window: text("window"),
  topCreatives: text("top_creatives"),
  fatiguing: text("fatiguing"),
  costPerAngle: text("cost_per_angle"),
  decisionMemoEn: text("decision_memo_en"),
  decisionMemoBm: text("decision_memo_bm"),
  selfCritique: text("self_critique"),
  banditAllocation: text("bandit_allocation"),
  linkedBriefs: jsonb("linked_briefs").$type<string[]>(),
  linkedExperiments: jsonb("linked_experiments").$type<string[]>(),
  linkedHypotheses: jsonb("linked_hypotheses").$type<string[]>(),
});

export const hypotheses = pgTable("hypotheses", {
  ...baseColumns(),
  statementEn: text("statement_en"),
  statementBm: text("statement_bm"),
  predictedEffect: text("predicted_effect"),
  predictedRange: text("predicted_range"),
  status: text("status"),
  predictionsHistory: text("predictions_history"),
  calibrationScore: real("calibration_score"),
  domain: jsonb("domain").$type<string[]>(),
  channel: jsonb("channel").$type<string[]>(),
  testExperiment: text("test_experiment"),
  discoveredRun: text("discovered_run"),
  resolvedRun: text("resolved_run"),
});

export const learnings = pgTable("learnings", {
  ...baseColumns(),
  claimEn: text("claim_en"),
  claimBm: text("claim_bm"),
  confidence: text("confidence"),
  halfLifeDays: integer("half_life_days"),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  status: text("status"),
  domain: jsonb("domain").$type<string[]>(),
  sourceHypotheses: jsonb("source_hypotheses").$type<string[]>(),
});

export const distributions = pgTable("distributions", {
  ...baseColumns(),                                                  // id, title, runId, approvalStatus, createdBy, complianceCheck, createdAt, updatedAt
  targetEntity: text("target_entity").notNull(),                     // "CreativeVariants" | "AuthorityArticles"
  targetId: uuid("target_id").notNull(),                             // FK to variant or article (no DB constraint)
  // Distributions channel vocabulary (Meta-paid | Meta-organic | YouTube | Article) intentionally differs from CHANNELS enum:
  // Distributions logs at the routing-channel abstraction, not the creative's target-channel abstraction (e.g. "YT" vs "YouTube").
  channel: text("channel").notNull(),                                // "Meta-paid" | "Meta-organic" | "YouTube" | "Article"
  status: text("status").notNull(),                                  // "routed" | "failed" | "skipped" | "dry-run"
  tool: text("tool"),                                                // MCP tool name; null for skipped/summary
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outputJson: jsonb("output_json"),
  errorMessage: text("error_message"),
  skipReason: text("skip_reason"),
  attempt: integer("attempt").notNull().default(1),
  dryRun: boolean("dry_run").notNull().default(false),
  authorStep: text("author_step").notNull(),                         // "D2b-route" | "D3-confirm"
}, (t) => ({
  runIdx: index("distributions_run_created_idx").on(t.runId, t.createdAt),
  runChannelIdx: index("distributions_run_channel_idx").on(t.runId, t.channel),
  targetIdx: index("distributions_target_idx").on(t.targetId),
}));

// ── Entity registry (used by the CRUD layer + filter DSL) ────────────────

export const ENTITIES = {
  Briefs: briefs,
  Scripts: scripts,
  AuthorityArticles: authorityArticles,
  CreativeVariants: creativeVariants,
  Experiments: experiments,
  PerformanceReports: performanceReports,
  Hypotheses: hypotheses,
  Learnings: learnings,
  Distributions: distributions,
} as const;

export type EntityName = keyof typeof ENTITIES;
export const ENTITY_NAMES = Object.keys(ENTITIES) as EntityName[];
