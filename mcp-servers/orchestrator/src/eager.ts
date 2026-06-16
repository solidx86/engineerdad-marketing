import {
  plan,
  verify,
  advance,
  executeWriteStep,
  executeCheck,
  UnsupportedToolError,
  type ExecDeps,
  type StageDefinition,
  type Step,
} from "@engineerdad/orchestrator";

/** Hard guard against an unbounded eager loop. Any single `plan()` call
 *  driving more than this many engine steps in sequence is a bug. */
export const EAGER_LOOP_LIMIT = 64;

/** True when the conductor must handle this step — anything that requires
 *  worker dispatch or a human action. Write + gate-with-check are handled
 *  inside `runEagerLoop` per ADR-023. */
export function isConductorRelevant(step: Step): boolean {
  if (step.kind === "spawn" || step.kind === "fanout") return true;
  if (step.kind === "done" || step.kind === "halt") return true;
  if (step.kind === "gate" && !step.check) return true; // terminal gate, no check
  return false;
}

/** Synthesize a `halt` step from a write-step verify failure. */
export function makeHalt(stepId: string, problems: string[]): Step {
  return { kind: "halt", stepId, reason: problems.join("; ") };
}

/** Strip the `check` field so the conductor sees a terminal gate and STOPs
 *  immediately — no double-execute, no double-verify. */
export function makeGateStop(gate: Extract<Step, { kind: "gate" }>): Step {
  return { kind: "gate", stepId: gate.stepId, gate: gate.gate, message: gate.message };
}

export interface EagerPlanResult {
  runId: string;
  step: Step;
}

/**
 * Drive `engine.plan` in a loop, executing every write step and gate-check
 * in-process via the `ExecDeps` dispatch path. Returns at the first step
 * the conductor must handle (spawn / fanout / terminal-gate / done / halt).
 *
 * Backwards compatibility: an `UnsupportedToolError` from the dispatch table
 * (i.e. a tool whose package hasn't been graduated to library imports yet)
 * is caught and the inline step is returned to the conductor unchanged.
 * Removed once Phase G's extractions land.
 */
export async function runEagerLoop(
  input: { runId?: string; args?: string },
  registry: StageDefinition[],
  deps: ExecDeps,
): Promise<EagerPlanResult> {
  let runId = input.runId;
  let runArgs = input.args;

  for (let guard = 0; guard < EAGER_LOOP_LIMIT; guard++) {
    const result = await plan({ runId, args: runArgs }, registry);
    runId = result.runId;
    runArgs = undefined; // only on the first iteration

    if (isConductorRelevant(result.step)) return result;

    try {
      if (result.step.kind === "write") {
        const callResults = await executeWriteStep(result.step, deps);
        const v = await verify(runId, result.step.stepId, callResults, registry);
        if (!v.ok) {
          return { runId, step: makeHalt(result.step.stepId, v.problems) };
        }
        await advance(runId, result.step.stepId, callResults, registry);
        continue;
      }

      if (result.step.kind === "gate" && result.step.check) {
        const checkResult = await executeCheck(result.step.check, deps);
        const v = await verify(runId, result.step.stepId, checkResult, registry);
        if (!v.ok) return { runId, step: makeGateStop(result.step) };
        await advance(runId, result.step.stepId, checkResult, registry);
        continue;
      }
    } catch (err) {
      if (err instanceof UnsupportedToolError) return result;
      throw err;
    }

    // Defensive: a step kind we didn't handle. Surface it.
    return result;
  }

  throw new Error(`eager-execute loop guard tripped after ${EAGER_LOOP_LIMIT} iterations`);
}
