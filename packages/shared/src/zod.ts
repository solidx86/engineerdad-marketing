import { z } from "zod";

export const LangSchema = z.enum(["en", "ms"]);

export const BilingualSchema = z.object({
  en: z.string().min(1),
  ms: z.string().min(1),
});

export const PersonaSchema = z.enum([
  "engineer_dad_archetype",
  "young_parents_25_35",
  "established_parents_35_45",
  "single_income_conservative",
  "dual_income_growth",
  "pre_retirement_prs_focus",
  "business_owner_self_employed",
  "salaried_professional_top_up",
]);

export const FunnelStageSchema = z.enum(["TOFU", "MOFU", "BOFU"]);
export const BudgetBucketSchema = z.enum(["70", "20", "10"]);
export const ProofTypeSchema = z.enum(["data", "testimonial", "case_study", "screenshot"]);

export const ApprovalStatusSchema = z.enum([
  "Draft",
  "Awaiting Approval",
  "Approved",
  "Rejected",
  "Published",
]);

export const CreatedBySchema = z.enum([
  "Brain",
  "Targeting",
  "ContentGen",
  "MediaProd",
  "XOS",
  "Tracking",
  "Analytics",
  "Human",
]);

export const EmotionalRegisterSchema = z.enum([
  "fear",
  "aspiration",
  "curiosity",
  "proof",
  "contrarian",
  "identity",
]);

export const ScriptFormatSchema = z.enum(["Reel", "Feed", "Carousel", "YT-Long", "YT-Short"]);
export const AspectSchema = z.enum(["9:16", "1:1", "16:9", "4:5"]);
export const AEOSchemaSchema = z.enum(["FAQ", "HowTo", "Article"]);
export const ArticleChannelSchema = z.enum([
  "Blog",
  "Medium",
  "LinkedIn",
  "YouTube-description",
]);

export const ExperimentLifecycleStatusSchema = z.enum(["Designed", "Running", "Concluded"]);
export const PrimaryMetricSchema = z.enum(["cpa", "hook_rate", "thumbstop", "ctr"]);

export const HypothesisStatusSchema = z.enum([
  "Open",
  "Confirmed",
  "Refuted",
  "Inconclusive",
  "Superseded",
]);

export const LearningConfidenceSchema = z.enum(["Tentative", "Working", "Proven"]);
export const LearningStatusSchema = z.enum(["Active", "Superseded", "Archived"]);

export const DomainSchema = z.enum([
  "unit_trusts",
  "PRS",
  "children_fund",
  "education_fund",
  "TOFU",
  "MOFU",
  "BOFU",
]);

const baseRow = {
  runId: z.string().min(1),
  approvalStatus: ApprovalStatusSchema,
  createdBy: CreatedBySchema,
  complianceCheck: z.boolean(),
};

export const BriefSchema = z.object({
  ...baseRow,
  title: BilingualSchema,
  persona: PersonaSchema,
  angle: z.string().min(1),
  promise: BilingualSchema,
  proofTypes: z.array(ProofTypeSchema).min(1),
  funnelStage: FunnelStageSchema,
  body: BilingualSchema,
  sourceInsights: z.string(),
  budgetBucket: BudgetBucketSchema,
  linkedHypothesisIds: z.array(z.string()),
});

export const ValueSegmentBankSchema = z
  .array(BilingualSchema)
  .min(6, "valueSegmentBank must contain at least 6 distinct value segments (§8)");

// ── Claim binding (ADR-030 data-first claim binding) ──
//   One binding per quantitative financial claim in the Script. Authored at
//   content-writer, reviewed at HG2, executed (never invented) by the
//   creative-director, enforced by C1 (verify-content) + P1 (verify-produce).
//   `kind` is decided by "does this statement assert a financial number?":
//     • data        — yes, and a vetted chart depicts that scenario+numbers
//                      ⇒ chartRef set, figures trace to the chart YAML.
//     • gap         — yes, but no dataset depicts it yet ⇒ HELD; gapNote set,
//                      chartRef null. (No reword-to-keep-the-number escape.)
//     • qualitative — no financial number asserted ⇒ no chart.
export const ClaimKindSchema = z.enum(["data", "qualitative", "gap"]);

export const ClaimBindingSchema = z
  .object({
    claim: z.string().min(1),
    kind: ClaimKindSchema,
    chartRef: z.string().min(1).nullable(),
    figures: z.array(z.string()),
    takeaway: z.string(),
    gapNote: z.string().nullable(),
  })
  .refine((b) => b.kind !== "data" || (b.chartRef !== null && b.figures.length > 0), {
    message: "kind:data requires a chartRef and at least one figure that traces to the chart",
  })
  .refine((b) => b.kind !== "gap" || (b.chartRef === null && (b.gapNote ?? "").trim().length > 0), {
    message: "kind:gap requires chartRef=null and a non-empty gapNote",
  })
  .refine((b) => b.kind !== "qualitative" || b.chartRef === null, {
    message: "kind:qualitative must have chartRef=null (no number asserted ⇒ no chart)",
  });

export const ScriptSchema = z.object({
  ...baseRow,
  briefId: z.string().min(1),
  format: ScriptFormatSchema,
  funnelStage: FunnelStageSchema,
  hook: BilingualSchema,
  script: BilingualSchema,
  cta: BilingualSchema,
  durationSec: z.number().positive(),
  proofRefs: z.array(z.string()),
  // ADR-030: per-claim data bindings (default [] for legacy/brand scripts).
  claimBindings: z.array(ClaimBindingSchema).default([]),
});

export const AuthorityArticleSchema = z.object({
  ...baseRow,
  topic: z.string().min(1),
  targetQuery: z.string().min(1),
  body: BilingualSchema,
  citations: z.array(z.string()),
  aeoSchema: AEOSchemaSchema,
  targetChannels: z.array(ArticleChannelSchema).min(1),
});

export const RenderStateSchema = z.enum([
  "HeygenGenerating",
  "HeygenCompleted",
  "Uploaded",
  "RenderFailed",
]);

export const VariantSchema = z.object({
  ...baseRow,
  scriptId: z.string().min(1),
  format: ScriptFormatSchema,
  aspect: AspectSchema,
  shotlistEN: z.string().min(1),
  shotlistBM: z.string().min(1),
  thumbnailBrief: z.string().min(1),
  estimatedCostMyr: z.number().nonnegative(),
  assetFiles: z.array(z.string()),
  // Reel render lifecycle (per 2026-05-28-heygen-reel-pipeline). Null/absent
  // for static-renderer formats (Feed, Carousel) and Reels that haven't
  // started rendering.
  reelHeygenJobId: z.string().nullable().optional(),
  renderState: RenderStateSchema.nullable().optional(),
  renderStartedAt: z.string().nullable().optional(),
});

// ── Reel shotlist (per 2026-05-28-heygen-reel-pipeline §5.1) ──
//   The creative-director's per-Reel output. Validated at the orchestrator
//   boundary; the reel-render-worker treats a parsed instance as the source
//   of truth for face/visual cut decisions. estimatedSeconds is a planning
//   hint — real timings come from HeyGen word-alignment in the worker.
export const ReelSceneTypeEnum = z.enum(["face", "visual"]);

const reelWordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export const ReelShotlistSceneSchema = z
  .object({
    // creative-director emits `scene: number` per SceneCard; the
    // reel-worker-input projection converts to string for the worker.
    scene: z.union([z.number(), z.string().min(1)]),
    voiceover: z.string(),
    onScreenText: z.string(),
    chartRef: z.string().nullable(),
    // A `visual` is data-backed (chartRef) XOR concept (visualBrief).
    visualBrief: z.string().nullable().optional(),
    // `explains` is the one-line takeaway; rendered on-frame as the support
    // line for visual scenes (brand-contract §8). null on face.
    explains: z.string().nullable().optional(),
    shotNotes: z.string(),
    sceneType: ReelSceneTypeEnum,
    estimatedSeconds: z.number().positive(),
  })
  // VO budget: face ≤30, visual ≤45 (Reel pacing).
  .refine(
    (s) => reelWordCount(s.voiceover) <= (s.sceneType === "face" ? 30 : 45),
    { message: "voiceover exceeds the per-scene word budget (face ≤30, visual ≤45)" },
  )
  // face ⇒ no chartRef, no visualBrief.
  .refine(
    (s) => s.sceneType !== "face" || (s.chartRef === null && (s.visualBrief ?? null) === null),
    { message: "'face' scenes must have null chartRef and null visualBrief" },
  )
  // visual ⇒ exactly one of chartRef / visualBrief (XOR).
  .refine(
    (s) => {
      if (s.sceneType !== "visual") return true;
      const hasChart = s.chartRef !== null;
      const hasBrief = typeof s.visualBrief === "string" && s.visualBrief.trim().length > 0;
      return hasChart !== hasBrief;
    },
    {
      message:
        "'visual' scenes need exactly one of chartRef (data visual) or visualBrief (concept visual)",
    },
  );

// Per ADR-020: aspect is a deterministic function of format (Reel⇒9:16),
// owned by the MATRIX in packages/shared/src/derive/specs.ts. Asking the
// creative-director to declare it would be the G-series anti-pattern —
// LLM re-derives a fact a pure function already owns. The projection in
// packages/orchestrator/src/produce/reel-worker-input.ts hardcodes "9:16".
export const ReelShotlistSchema = z.object({
  format: z.literal("Reel"),
  hook: z.object({ en: z.string().min(1), ms: z.string().min(1) }),
  shotlistEn: z.array(ReelShotlistSceneSchema).min(1),
  targetSeconds: z.number().int().min(15).max(60),
  faceFirstHook: z.boolean(),
});

export const ExperimentFactorSchema = z.object({
  name: z.string().min(1),
  levels: z.array(z.string().min(1)).min(2),
});

export const ExperimentCellSchema = z.object({
  cellId: z.string().min(1),
  factorLevels: z.record(z.string(), z.string()),
  allocationPct: z.number().min(0).max(100),
});

export const ExperimentSchema = z.object({
  runId: z.string().min(1),
  hypothesis: z.string().min(1),
  factors: z.array(ExperimentFactorSchema).min(2),
  cells: z.array(ExperimentCellSchema).min(1),
  primaryMetric: PrimaryMetricSchema,
  dailyBudgetMyr: z.number().positive(),
  durationDays: z.number().int().positive(),
  status: ExperimentLifecycleStatusSchema,
  linkedVariantIds: z.array(z.string()),
  readout: z.string().optional(),
});

export const PredictedEffectSchema = z.object({
  metric: z.string().min(1),
  direction: z.enum(["up", "down"]),
  magnitudePct: z.number(),
  confidence: z.number().min(0).max(1),
});

export const PredictionRecordSchema = z.object({
  runId: z.string().min(1),
  predicted: PredictedEffectSchema,
  actual: z.object({ metric: z.string(), value: z.number() }),
  error: z.number(),
});

export const HypothesisSchema = z.object({
  statement: BilingualSchema,
  predictedEffect: PredictedEffectSchema,
  predictedRange: z.string().min(1),
  testExperimentId: z.string().optional(),
  status: HypothesisStatusSchema,
  predictionsHistory: z.array(PredictionRecordSchema),
  calibrationScore: z.number(),
  discoveredRunId: z.string().min(1),
  resolvedRunId: z.string().optional(),
  domain: z.array(DomainSchema).min(1),
});

export const LearningSchema = z.object({
  claim: BilingualSchema,
  confidence: LearningConfidenceSchema,
  halfLifeDays: z.number().positive(),
  sourceHypothesisIds: z.array(z.string()).min(1),
  lastValidatedAt: z.string().min(1),
  status: LearningStatusSchema,
  domain: z.array(DomainSchema).min(1),
});

export const BanditAllocationSchema = z.object({
  arm: z.record(z.string(), z.string()),
  nPulls: z.number().int().nonnegative(),
  posteriorMeanCpa: z.number(),
  posteriorUncertainty: z.number().nonnegative(),
  budgetShare: z.number().min(0).max(1),
  bucketLabel: BudgetBucketSchema,
});

export const PerformanceReportSchema = z.object({
  runId: z.string().min(1),
  windowDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  topCreatives: z.array(z.record(z.string(), z.unknown())),
  fatiguing: z.array(z.record(z.string(), z.unknown())),
  costPerAngle: z.array(z.record(z.string(), z.unknown())),
  decisionMemo: BilingualSchema,
  selfCritique: z.string(),
  banditAllocation: z.array(BanditAllocationSchema),
  linkedBriefIds: z.array(z.string()),
  linkedExperimentIds: z.array(z.string()),
  linkedHypothesisIds: z.array(z.string()),
  approvalStatus: ApprovalStatusSchema,
  createdBy: CreatedBySchema,
});

export const DistributionRowSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().min(1),
  // MUST stay in sync with DISTRIBUTION_TARGET_ENTITY in @engineerdad/store schema.ts
  targetEntity: z.enum(["CreativeVariants", "AuthorityArticles"]),
  targetId: z.string().min(1),
  // MUST stay in sync with DISTRIBUTION_CHANNEL in @engineerdad/store schema.ts
  channel: z.enum(["Meta-paid", "Meta-organic", "YouTube", "Article"]),
  // MUST stay in sync with DISTRIBUTION_STATUS in @engineerdad/store schema.ts
  status: z.enum(["routed", "failed", "skipped", "dry-run"]),
  tool: z.string().nullable(),
  attemptedAt: z.string().min(1),
  completedAt: z.string().nullable(),
  outputJson: z.unknown(),
  errorMessage: z.string().nullable(),
  skipReason: z.string().nullable(),
  attempt: z.number().int().nonnegative(),
  dryRun: z.boolean(),
  // MUST stay in sync with DISTRIBUTION_AUTHOR_STEP in @engineerdad/store schema.ts
  authorStep: z.enum(["D2b-route", "D3-confirm"]),
  approvalStatus: z.string().min(1),
  complianceCheck: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const ContentGenOutputSchema = z.object({
  runId: z.string().min(1),
  valueSegmentBank: ValueSegmentBankSchema,
  scripts: z.array(ScriptSchema).min(1),
  articles: z.array(AuthorityArticleSchema),
});

// ── Organic Social ──────────────────────────────────────────────────────────

export const OrganicStatus = z.enum([
  "Drafted",
  "Approved",
  "Rejected",
  "Published",
  "Failed",
]);
export type OrganicStatus = z.infer<typeof OrganicStatus>;

export const OrganicLanguage = z.enum(["EN", "BM"]);
export type OrganicLanguage = z.infer<typeof OrganicLanguage>;

export const MediaProductionChannelSchema = z.enum([
  "Meta-paid",
  "Meta-organic",
  "YouTube",
  "YouTube-Shorts",
  "IG-organic",
  "FB-organic",
]);

const MediaProductionVariantBaseSchema = z.object({
  variantId: z.string().min(1),
  channels: z.array(MediaProductionChannelSchema).optional(),
  organicLanguage: OrganicLanguage.optional(),
  organicCaptionEN: z
    .string()
    .max(2200, "Organic Caption EN must be ≤2200 chars (IG limit)")
    .optional(),
  organicCaptionBM: z
    .string()
    .max(2200, "Organic Caption BM must be ≤2200 chars (IG limit)")
    .optional(),
  organicHashtagsIG: z
    .array(z.string())
    .min(8)
    .max(15)
    .refine((arr) => arr.every((h) => h.startsWith("#")), "Hashtags must start with #")
    .optional(),
  organicHashtagsFB: z
    .array(z.string())
    .min(1)
    .max(3)
    .refine((arr) => arr.every((h) => h.startsWith("#")), "Hashtags must start with #")
    .optional(),
});

// Per spec §3 / decision #21: v1 publishes each Variant in ONE language only.
// organicLanguage defaults to "EN" if unset; only the matching caption is required.
// The off-language caption may be present (e.g. authored at HG3) but is not required.
export const MediaProductionVariantSchema = MediaProductionVariantBaseSchema.refine(
  (v) => {
    if (!v.channels?.includes("Meta-organic")) return true;
    const lang = v.organicLanguage ?? "EN";
    const caption = lang === "EN" ? v.organicCaptionEN : v.organicCaptionBM;
    return caption && caption.length > 0 && v.organicHashtagsIG && v.organicHashtagsFB;
  },
  "Variants with Channels ∋ Meta-organic require Organic Caption + Hashtags IG + Hashtags FB",
);

export const MediaProductionOutputSchema = z.object({
  variants: z.array(MediaProductionVariantSchema).min(1),
  totals: z.object({
    totalEstimatedCostMYR: z.number().nonnegative(),
  }),
});

/**
 * §8 "80% proof, 20% brand" — at least 80% of scripts in a run must cite ≥1 proof ref.
 * Per-Script schema permits proofRefs:[] so individual brand scripts are still valid;
 * the ratio is enforced at the batch boundary by Brain / Content Gen output validation.
 */
export interface BatchValidationResult {
  ok: boolean;
  ratio: number;
  withProof: number;
  total: number;
  message?: string;
}

export function validateScriptBatch(
  scripts: Array<z.infer<typeof ScriptSchema>>,
  minRatio = 0.8,
): BatchValidationResult {
  const total = scripts.length;
  if (total === 0) {
    return { ok: false, ratio: 0, withProof: 0, total: 0, message: "empty script batch" };
  }
  const withProof = scripts.filter((s) => s.proofRefs.length >= 1).length;
  const ratio = withProof / total;
  return {
    ok: ratio >= minRatio,
    ratio,
    withProof,
    total,
    message:
      ratio >= minRatio
        ? undefined
        : `proofRefs ratio ${(ratio * 100).toFixed(1)}% below required ${(minRatio * 100).toFixed(0)}% (§8)`,
  };
}
