import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";

/**
 * The fixture stage — a real 2-step stage that proves the engine + conductor
 * end-to-end without depending on a domain agent. Each step spawns a
 * general-purpose worker with a deterministic echo prompt; its verifier
 * asserts the worker echoed back the expected `{ ok, step }`.
 *
 * Phase 2 ships this as the orchestrator MCP's live registry. Phase 5 swaps
 * in the real produce stage.
 */

const STEP_IDS = ["fixture-1", "fixture-2"] as const;

function echoPrompt(stepId: string): string {
  return [
    `Fixture step "${stepId}" of an orchestrator smoke test.`,
    "Do nothing else. Reply with exactly this JSON and nothing more:",
    `{"ok":true,"step":"${stepId}"}`,
  ].join("\n");
}

/** Accept the worker result as either a parsed object or a JSON string. */
function coerce(result: unknown): { ok?: unknown; step?: unknown } | null {
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as { ok?: unknown; step?: unknown };
    } catch {
      return null;
    }
  }
  if (result !== null && typeof result === "object") {
    return result as { ok?: unknown; step?: unknown };
  }
  return null;
}

function verifyEcho(stepId: string) {
  return (_run: RunState, result: unknown): VerifyResult => {
    const r = coerce(result);
    const problems: string[] = [];
    if (!r || r.ok !== true) {
      problems.push(`step ${stepId}: worker did not echo ok:true`);
    }
    if (!r || r.step !== stepId) {
      problems.push(`step ${stepId}: worker echoed wrong step "${String(r?.step)}"`);
    }
    return { ok: problems.length === 0, problems };
  };
}

const steps: StepSpec[] = STEP_IDS.map((id) => ({
  id,
  kind: "spawn",
  build: (): Step => ({
    kind: "spawn",
    stepId: id,
    agent: "general-purpose",
    spawnPrompt: echoPrompt(id),
  }),
  verify: verifyEcho(id),
}));

export const fixtureStage: StageDefinition = {
  id: "fixture",
  steps,
};
