// E-034 — Postgres-resident run state. Public API: createRun /
// loadRunState / upsertStep / setRunStage / listRuns / resetDbCache.
// Internals use the shared Drizzle client.
import { desc, eq, sql } from "drizzle-orm";
import { getDb, closeDb, resetDbCache as resetClientCache } from "./db.js";
import { runs, runSteps } from "./schema.js";
import type {
  RunStage, RunStatus, RunState, RunStepState, StepStatus,
} from "./types.js";

/** Test-only: reset module caches (no DB writes). truncatePg() handles
 *  per-test data cleanup. */
export function resetDbCache(): void {
  resetClientCache();
}

/** Insert a new run row at the given stage with status "active". */
export async function createRun(
  runId: string,
  stage: RunStage,
  params: Record<string, unknown>,
): Promise<void> {
  await getDb().insert(runs).values({
    id: runId,
    stage,
    status: "active",
    params,
  });
}

/** Join runs + run_steps into a RunState, or null when the run does not exist. */
export async function loadRunState(runId: string): Promise<RunState | null> {
  const db = getDb();
  const runRow = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (runRow.length === 0) return null;
  // Order by createdAt to preserve insertion order. updatedAt advances on
  // every re-upsert and would reorder steps mid-run; the webapp's
  // RunStepTable renders array order verbatim.
  const stepRows = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(runSteps.createdAt);
  const steps: RunStepState[] = stepRows.map((r) => ({
    stepId: r.stepId,
    stage: r.stage,
    status: r.status as StepStatus,
    result: r.result ?? null,
    problems: (r.problems ?? []) as string[],
    attempts: r.attempts,
  }));
  return {
    runId: runRow[0]!.id,
    stage: runRow[0]!.stage as RunStage,
    status: runRow[0]!.status as RunStatus,
    params: (runRow[0]!.params ?? {}) as Record<string, unknown>,
    steps,
  };
}

/** Insert-or-replace a run_steps row, keyed on (runId, stepId). */
export async function upsertStep(runId: string, step: RunStepState): Promise<void> {
  await getDb()
    .insert(runSteps)
    .values({
      runId,
      stepId: step.stepId,
      stage: step.stage,
      status: step.status,
      result: step.result ?? null,
      problems: (step.problems ?? []) as string[],
      attempts: step.attempts,
    })
    .onConflictDoUpdate({
      target: [runSteps.runId, runSteps.stepId],
      set: {
        stage: step.stage,
        status: step.status,
        result: step.result ?? null,
        problems: (step.problems ?? []) as string[],
        attempts: step.attempts,
        updatedAt: sql`now()`,
      },
    });
}

/** Update a run's stage + status. */
export async function setRunStage(
  runId: string, stage: RunStage, status: RunStatus,
): Promise<void> {
  await getDb()
    .update(runs)
    .set({ stage, status, updatedAt: sql`now()` })
    .where(eq(runs.id, runId));
}

export interface RunSummary {
  runId: string;
  stage: RunStage;
  status: RunStatus;
  stepCount: number;
  createdAt: number;   // epoch ms — preserved shape for callers
  updatedAt: number;
}

/** All runs, newest first — the input to /status. */
export async function listRuns(): Promise<RunSummary[]> {
  // Typed Drizzle select: timestamps come back as JS Dates (not raw strings),
  // step_count is a sql subquery. Number() coerces the bigint COUNT (which
  // postgres-js surfaces as a string by default).
  const rows = await getDb()
    .select({
      id: runs.id,
      stage: runs.stage,
      status: runs.status,
      createdAt: runs.createdAt,
      updatedAt: runs.updatedAt,
      stepCount: sql<number>`(SELECT COUNT(*) FROM orchestrator.run_steps s WHERE s.run_id = ${runs.id})`,
    })
    .from(runs)
    .orderBy(desc(runs.createdAt));
  return rows.map((r) => ({
    runId: r.id,
    stage: r.stage as RunStage,
    status: r.status as RunStatus,
    stepCount: Number(r.stepCount),
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  }));
}

/** Async-aware close for tests' afterAll. */
export { closeDb };
