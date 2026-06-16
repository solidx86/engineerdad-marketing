import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import { verifyBrief } from "../verifiers/verify-brief.js";
import { reviewUiUrl } from "../webapp-url.js";

/**
 * The brief stage — `brief-writer` translates the Decision Memo into a pack of
 * 12 message-angle Briefs. B1-write spawns brief-writer with the Memo's
 * recommendedAngles / personas / topCreatives / hypothesisIds; B2-gate is
 * HUMAN GATE 1 — a passable check on Briefs marked Approved for the run.
 *
 * The spawn-prompt format is brain.md §E's, now typed here. Phase 6 wires this
 * into the live registry between `synthesize` and `content`.
 */

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/** Flatten one mcp__store__query call-result into a row array. */
function rowsOf(callResult: unknown): unknown[] {
  return Array.isArray(callResult) ? callResult : [];
}

/** The strategic inputs brief-writer needs out of the Decision Memo. */
function memoInputs(run: RunState): Record<string, unknown> {
  const memo = stepResult<Record<string, unknown>>(run, "S1-reason") ?? {};
  return {
    recommendedAngles: memo["recommendedAngles"] ?? [],
    personas: memo["personas"] ?? [],
    topCreatives: memo["topCreatives"] ?? [],
    hypothesisIds: memo["hypothesisIds"] ?? [],
  };
}

const b1Write: StepSpec = {
  id: "B1-write",
  kind: "spawn",
  build: (run): Step => ({
    kind: "spawn",
    stepId: "B1-write",
    agent: "brief-writer",
    spawnPrompt: [
      `Run ${run.runId}: you are brief-writer. Translate the Decision Memo`,
      "inputs below into a pack of 12 message-angle Briefs — one store row",
      "each, bilingual EN/BM, across the 70/20/10 budget buckets. Follow your",
      "agent instructions exactly. Return { angles: [...] } as your final JSON.",
      "",
      "DECISION MEMO INPUTS:",
      JSON.stringify(memoInputs(run), null, 2),
      "",
      "CANONICAL ANGLE TAXONOMY (HARD RULE):",
      "Every brief.angle MUST be one of recommendedAngles above, VERBATIM.",
      "The verifier hard-fails on any off-taxonomy angle.",
      "If you cannot reach 12 within these angles, emit fewer — skip, don't pad.",
    ].join("\n"),
  }),
  verify: (run, result): VerifyResult => {
    const inputs = memoInputs(run) as { recommendedAngles?: string[] };
    return verifyBrief(result, inputs.recommendedAngles);
  },
};

const b2Gate: StepSpec = {
  id: "B2-gate",
  kind: "gate",
  build: (run): Step => ({
    kind: "gate",
    stepId: "B2-gate",
    gate: "HG1",
    message: `Briefs written. Awaiting HUMAN GATE 1 — review the 12 message angles in the webapp at ${reviewUiUrl()}/review/briefs, then approve to proceed to content.`,
    check: {
      tool: "mcp__store__query",
      args: {
        entity: "Briefs",
        filter: { runId: run.runId, approvalStatus: "Approved" },
      },
    },
  }),
  verify: (_run, result): VerifyResult =>
    rowsOf(result).length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["HG1 not cleared — no approved Briefs for this run"] },
};

export const briefStage: StageDefinition = {
  id: "brief",
  steps: [b1Write, b2Gate],
};
