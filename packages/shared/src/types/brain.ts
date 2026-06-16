/**
 * Shared Brain types. V2 is the current Decision Memo shape; V3 will extend it
 * in Brain Initiative Phase 2 (MoE-Critic). experimentParams is optional —
 * Brain emits no block on cold-start (single recommended angle) and the
 * experiment stage takes the legitimate-skip path.
 */

export interface ExperimentParams {
  hypothesis: string;
  factors: Array<{ name: string; levels: string[] }>;
  holdConstant: string[];
  primaryMetric: "cpa" | "hook_rate" | "thumbstop" | "ctr";
  dailyBudgetMyr: number;
  durationDays: number;
}

export const EXPERIMENT_STATUS = ["full", "degraded", "single-cell", "broken"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUS)[number];

export interface DecisionMemoV2 {
  schemaVersion: 2;
  runId: string;
  memoId: string;
  recommendedAngles: string[];
  personas: string[];
  topCreatives: unknown;
  hypothesisIds: string[];
  banditAllocation: unknown;
  experimentParams?: ExperimentParams;
  notes?: string;
}
