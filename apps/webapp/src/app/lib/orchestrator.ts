// Thin adapter over @engineerdad/orchestrator. Reads runs + run_steps from
// Postgres (orchestrator schema) via the package's state.ts; reads step_results
// payloads via loadPayload.
import "server-only";
import {
  listRuns as _listRuns,
  loadRunState,
  loadPayload,
  type RunStatus,
  type StepStatus,
} from "@engineerdad/orchestrator";

export type { RunStatus, StepStatus };

export interface RunRow {
  runId: string;
  stage: string;
  status: RunStatus;
  stepCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StepRow {
  runId: string;
  stepId: string;
  stage: string;
  status: StepStatus;
  result: unknown;
  problems: string[];
  attempts: number;
}

export { currentGate, type GateName } from "./gate";

export async function listRuns(opts: { limit?: number } = {}): Promise<RunRow[]> {
  const summaries = await _listRuns();
  const out = summaries.map((s) => ({
    runId: s.runId,
    stage: s.stage as string,
    status: s.status,
    stepCount: s.stepCount,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  }));
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const all = await listRuns();
  return all.find((r) => r.runId === runId) ?? null;
}

export async function listSteps(runId: string): Promise<StepRow[]> {
  const state = await loadRunState(runId);
  if (!state) return [];
  return state.steps.map((s) => ({
    runId,
    stepId: s.stepId,
    stage: s.stage as string,
    status: s.status,
    result: s.result,
    problems: s.problems ?? [],
    attempts: s.attempts ?? 0,
  }));
}

export async function loadStepPayload(stepResultId: string): Promise<unknown> {
  return loadPayload(stepResultId);
}
