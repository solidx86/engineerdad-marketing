export type Lang = "en" | "ms";

export interface Bilingual<T = string> {
  en: T;
  ms: T;
}

export type Persona =
  | "engineer_dad_archetype"
  | "young_parents_25_35"
  | "established_parents_35_45"
  | "single_income_conservative"
  | "dual_income_growth"
  | "pre_retirement_prs_focus"
  | "business_owner_self_employed"
  | "salaried_professional_top_up";

export type FunnelStage = "TOFU" | "MOFU" | "BOFU";
export type BudgetBucket = "70" | "20" | "10";
export type ProofType = "data" | "testimonial" | "case_study" | "screenshot";

export type ApprovalStatus =
  | "Draft"
  | "Awaiting Approval"
  | "Approved"
  | "Rejected"
  | "Published";

export type CreatedBy =
  | "Brain"
  | "Targeting"
  | "ContentGen"
  | "MediaProd"
  | "XOS"
  | "Tracking"
  | "Analytics"
  | "Human";

export type EmotionalRegister =
  | "fear"
  | "aspiration"
  | "curiosity"
  | "proof"
  | "contrarian"
  | "identity";

export type ScriptFormat = "Reel" | "Feed" | "Carousel" | "YT-Long" | "YT-Short";
export type Aspect = "9:16" | "1:1" | "16:9" | "4:5";
export type AEOSchema = "FAQ" | "HowTo" | "Article";
export type ArticleChannel = "Blog" | "Medium" | "LinkedIn" | "YouTube-description";

/**
 * Lifecycle status for an Experiment row (Designed → Running → Concluded).
 * Distinct from the occupancy-classification {@link ExperimentStatus} union in
 * `./types/brain.ts` (full | degraded | single-cell | broken) that travels on
 * the `experiment_status` column.
 */
export type ExperimentLifecycleStatus = "Designed" | "Running" | "Concluded";
export type PrimaryMetric = "cpa" | "hook_rate" | "thumbstop" | "ctr";

export type HypothesisStatus =
  | "Open"
  | "Confirmed"
  | "Refuted"
  | "Inconclusive"
  | "Superseded";

export type LearningConfidence = "Tentative" | "Working" | "Proven";
export type LearningStatus = "Active" | "Superseded" | "Archived";

export type Domain =
  | "unit_trusts"
  | "PRS"
  | "children_fund"
  | "education_fund"
  | "TOFU"
  | "MOFU"
  | "BOFU";

export interface BaseRow {
  runId: string;
  approvalStatus: ApprovalStatus;
  createdBy: CreatedBy;
  complianceCheck: boolean;
}

export interface Brief extends BaseRow {
  title: Bilingual;
  persona: Persona;
  angle: string;
  promise: Bilingual;
  proofTypes: ProofType[];
  funnelStage: FunnelStage;
  body: Bilingual;
  sourceInsights: string;
  budgetBucket: BudgetBucket;
  linkedHypothesisIds: string[];
}

export interface Script extends BaseRow {
  briefId: string;
  format: ScriptFormat;
  funnelStage: FunnelStage;
  hook: Bilingual;
  script: Bilingual;
  cta: Bilingual;
  durationSec: number;
  proofRefs: string[];
}

export interface AuthorityArticle extends BaseRow {
  topic: string;
  targetQuery: string;
  body: Bilingual;
  citations: string[];
  aeoSchema: AEOSchema;
  targetChannels: ArticleChannel[];
}

export interface Variant extends BaseRow {
  scriptId: string;
  format: ScriptFormat;
  aspect: Aspect;
  shotlistEN: string;
  shotlistBM: string;
  thumbnailBrief: string;
  estimatedCostMyr: number;
  assetFiles: string[];
  // Reel render lifecycle (per 2026-05-28-heygen-reel-pipeline). Null for
  // static-renderer formats (Feed, Carousel) and Reels that haven't started.
  reelHeygenJobId?: string | null;
  renderState?: RenderState | null;
  renderStartedAt?: string | null;
}

export type RenderState =
  | "HeygenGenerating"
  | "HeygenCompleted"
  | "Uploaded"
  | "RenderFailed";

export interface ExperimentFactor {
  name: string;
  levels: string[];
}

export interface ExperimentCell {
  cellId: string;
  factorLevels: Record<string, string>;
  allocationPct: number;
}

export interface Experiment {
  runId: string;
  hypothesis: string;
  factors: ExperimentFactor[];
  cells: ExperimentCell[];
  primaryMetric: PrimaryMetric;
  dailyBudgetMyr: number;
  durationDays: number;
  status: ExperimentLifecycleStatus;
  linkedVariantIds: string[];
  readout?: string;
}

export interface PredictedEffect {
  metric: string;
  direction: "up" | "down";
  magnitudePct: number;
  confidence: number;
}

export interface PredictionRecord {
  runId: string;
  predicted: PredictedEffect;
  actual: { metric: string; value: number };
  error: number;
}

export interface Hypothesis {
  statement: Bilingual;
  predictedEffect: PredictedEffect;
  predictedRange: string;
  testExperimentId?: string;
  status: HypothesisStatus;
  predictionsHistory: PredictionRecord[];
  calibrationScore: number;
  discoveredRunId: string;
  resolvedRunId?: string;
  domain: Domain[];
}

export interface Learning {
  claim: Bilingual;
  confidence: LearningConfidence;
  halfLifeDays: number;
  sourceHypothesisIds: string[];
  lastValidatedAt: string;
  status: LearningStatus;
  domain: Domain[];
}

export interface BanditAllocation {
  arm: Record<string, string>;
  nPulls: number;
  posteriorMeanCpa: number;
  posteriorUncertainty: number;
  budgetShare: number;
  bucketLabel: BudgetBucket;
}

export interface PerformanceReport {
  runId: string;
  windowDays: 7 | 14 | 30;
  topCreatives: Array<Record<string, unknown>>;
  fatiguing: Array<Record<string, unknown>>;
  costPerAngle: Array<Record<string, unknown>>;
  decisionMemo: Bilingual;
  selfCritique: string;
  banditAllocation: BanditAllocation[];
  linkedBriefIds: string[];
  linkedExperimentIds: string[];
  linkedHypothesisIds: string[];
  approvalStatus: ApprovalStatus;
  createdBy: CreatedBy;
}

export interface DistributionRow {
  id: string;
  runId: string;
  title: string;
  targetEntity: "CreativeVariants" | "AuthorityArticles";
  targetId: string;
  channel: "Meta-paid" | "Meta-organic" | "YouTube" | "Article";
  status: "routed" | "failed" | "skipped" | "dry-run";
  tool: string | null;
  attemptedAt: string;       // ISO timestamp
  completedAt: string | null;
  outputJson: unknown;
  errorMessage: string | null;
  skipReason: string | null;
  attempt: number;
  dryRun: boolean;
  authorStep: "D2b-route" | "D3-confirm";
  approvalStatus: string;    // always "Logged" for this entity
  complianceCheck: boolean;  // always true (exempt)
  createdAt: string;
  updatedAt: string;
}

export interface ContentGenOutput {
  runId: string;
  valueSegmentBank: Bilingual[];
  scripts: Script[];
  articles: AuthorityArticle[];
}
