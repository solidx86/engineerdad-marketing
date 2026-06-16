import type {
  RunState,
  RunStage,
  RunStatus,
  StageDefinition,
  Step,
  StepSpec,
  VerifyResult,
} from "./types.js";
import { createRun, loadRunState, setRunStage, upsertStep } from "./state.js";
import { parseRunArgs } from "./run-args.js";
import { createBuildContext } from "./build-context.js";

/** What `plan` hands back — the minted/continued runId plus the next concrete Step. */
export interface PlanResult {
  runId: string;
  step: Step;
}

/** True when `run` already has a `done` run-step for `stepId`. */
function isStepDone(run: RunState, stepId: string): boolean {
  return run.steps.some((s) => s.stepId === stepId && s.status === "done");
}

/**
 * Continue a run, or mint a new one when `runId` is absent.
 * Pure function of persisted state — re-entry with the same state yields the same Step.
 *
 * Async because `StepSpec.build` may return a Promise<Step> when it stages
 * worker-input via `ctx.stageInput` (ADR-024). Sync-returning builds are
 * still supported — `Promise.resolve(...)` covers both shapes.
 */
export async function plan(
  input: { runId?: string; args?: string },
  registry: StageDefinition[],
): Promise<PlanResult> {
  if (registry.length === 0) throw new Error("plan: empty stage registry");

  let runId = input.runId;
  if (!runId) {
    runId = `run_${Math.floor(Date.now() / 1000)}`;
    await createRun(runId, registry[0]!.id, parseRunArgs(input.args ?? ""));
  }

  const run = await loadRunState(runId);
  if (!run) throw new Error(`plan: run not found: ${runId}`);

  if (run.stage === "done") {
    return { runId, step: { kind: "done", message: `run ${runId} complete` } };
  }

  const stageIdx = registry.findIndex((s) => s.id === run.stage);
  if (stageIdx === -1) throw new Error(`plan: unknown stage "${run.stage}"`);

  // Walk forward from the current stage to the first stage with a pending step.
  for (let i = stageIdx; i < registry.length; i++) {
    const stage = registry[i]!;
    const spec = stage.steps.find((sp) => !isStepDone(run, sp.id));
    if (spec) {
      const status: RunStatus = spec.kind === "gate" ? "awaiting_gate" : "active";
      if (stage.id !== run.stage || run.status !== status) {
        await setRunStage(runId, stage.id, status);
      }
      const ctx = createBuildContext(runId, spec.id);
      const step = await Promise.resolve(spec.build({ ...run, stage: stage.id }, ctx));
      return { runId, step };
    }
  }

  // Every stage exhausted — the run is complete.
  await setRunStage(runId, "done", "done");
  return { runId, step: { kind: "done", message: `run ${runId} complete` } };
}

/** Locate a StepSpec by id across every stage in the registry. */
function findStepSpec(registry: StageDefinition[], stepId: string): StepSpec | undefined {
  for (const stage of registry) {
    const spec = stage.steps.find((s) => s.id === stepId);
    if (spec) return spec;
  }
  return undefined;
}

/** Default acceptance test: a result is acceptable if it is non-null and carries no `error`. */
function defaultVerify(result: unknown): VerifyResult {
  if (result === null || result === undefined) {
    return { ok: false, problems: ["result is null"] };
  }
  if (typeof result === "object" && "error" in result) {
    const err = (result as { error: unknown }).error;
    return { ok: false, problems: [`result carries an error: ${String(err)}`] };
  }
  return { ok: true, problems: [] };
}

/** Run the StepSpec's verifier (or the default) against a worker result. */
export async function verify(
  runId: string,
  stepId: string,
  result: unknown,
  registry: StageDefinition[],
): Promise<VerifyResult> {
  const run = await loadRunState(runId);
  if (!run) throw new Error(`verify: run not found: ${runId}`);
  const spec = findStepSpec(registry, stepId);
  if (!spec) throw new Error(`verify: unknown stepId: ${stepId}`);
  return spec.verify ? await spec.verify(run, result) : defaultVerify(result);
}

/**
 * Mark a step done with its result, then roll the stage forward when its last
 * step completes. Returns the run's new {stage, status}.
 */
export async function advance(
  runId: string,
  stepId: string,
  result: unknown,
  registry: StageDefinition[],
): Promise<{ stage: RunStage; status: RunStatus }> {
  const run = await loadRunState(runId);
  if (!run) throw new Error(`advance: run not found: ${runId}`);

  const ownerIdx = registry.findIndex((st) => st.steps.some((sp) => sp.id === stepId));
  if (ownerIdx === -1) throw new Error(`advance: unknown stepId: ${stepId}`);
  const ownerStage = registry[ownerIdx]!;

  const prior = run.steps.find((s) => s.stepId === stepId);
  await upsertStep(runId, {
    stepId,
    stage: ownerStage.id,
    status: "done",
    result,
    problems: [],
    attempts: (prior?.attempts ?? 0) + 1,
  });

  // Recompute stage completion against freshly persisted state.
  const after = (await loadRunState(runId))!;
  const stageComplete = ownerStage.steps.every((sp) =>
    after.steps.some((s) => s.stepId === sp.id && s.status === "done"),
  );
  if (!stageComplete) {
    return { stage: ownerStage.id, status: "active" };
  }

  const nextStage = registry[ownerIdx + 1];
  if (nextStage) {
    await setRunStage(runId, nextStage.id, "active");
    return { stage: nextStage.id, status: "active" };
  }
  await setRunStage(runId, "done", "done");
  return { stage: "done", status: "done" };
}
