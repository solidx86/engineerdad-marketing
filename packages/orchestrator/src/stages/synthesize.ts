import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import { verifySynthesize } from "../verifiers/verify-synthesize.js";

/**
 * The synthesize stage — `brain` reasons. A single `spawn` of the `brain`
 * agent: it runs the §B 9-step reasoning scaffold over the analytics-stage
 * output and emits the §C Decision Memo. brain does NOT dispatch — the
 * orchestrator owns sequencing; the Memo flows straight into the brief stage.
 * No gate.
 *
 * The spawn-prompt format is brain.md §E's reasoning brief, now typed here.
 * Phase 6 wires this into the live registry between `analytics` and `brief`.
 */

/** Every analytics-stage step result, keyed by stepId — brain's raw signal. */
function analyticsSignal(run: RunState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of run.steps) {
    if (s.stage === "analytics") out[s.stepId] = s.result;
  }
  return out;
}

const s1Reason: StepSpec = {
  id: "S1-reason",
  kind: "spawn",
  build: (run): Step => ({
    kind: "spawn",
    stepId: "S1-reason",
    agent: "brain",
    spawnPrompt: [
      `You are brain, the strategic reasoner, for orchestrator run ${run.runId}.`,
      `Use runId "${run.runId}" verbatim — as the runId prop on every store write`,
      "(the Decision Memo, every Hypothesis, the Reflect Self-Critique) and as",
      "the runId field of the JSON you return. Do NOT mint a run — you have no",
      "tool to, and the orchestrator already owns this run's identity.",
      "",
      "Run the §B 9-step reasoning scaffold over the analytics-stage signal",
      "below and emit the §C Decision Memo as your final JSON message.",
      "",
      "Do NOT dispatch any subagent and do NOT call the Task tool — the",
      "orchestrator owns loop sequencing. The Memo's recommendedAngles flow",
      "into the brief stage next.",
      "",
      "ANALYTICS SIGNAL:",
      JSON.stringify(analyticsSignal(run), null, 2),
    ].join("\n"),
  }),
  verify: (_run, result): VerifyResult => verifySynthesize(result),
};

export const synthesizeStage: StageDefinition = {
  id: "synthesize",
  steps: [s1Reason],
};
