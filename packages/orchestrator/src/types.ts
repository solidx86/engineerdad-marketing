export type RunStage =
  | "fixture"
  | "tracking"
  | "analytics"
  | "synthesize"
  | "brief"
  | "content"
  | "produce"
  | "schedule"
  | "experiment"
  | "distribute"
  | "done";
export type RunStatus = "active" | "awaiting_gate" | "blocked" | "done";
export type StepStatus = "pending" | "done" | "failed";

export interface RunStepState {
  stepId: string;
  stage: string;
  status: StepStatus;
  result: unknown;
  problems: string[];
  attempts: number;
}

/** The full run state — the pure input to `plan`. */
export interface RunState {
  runId: string;
  stage: RunStage;
  status: RunStatus;
  params: Record<string, unknown>;
  steps: RunStepState[];
}

export type StepKind = "spawn" | "fanout" | "write" | "gate" | "done" | "halt";

/** A concrete next action, returned by `plan` for the conductor to execute. */
export type Step =
  | { kind: "spawn"; stepId: string; agent: string; spawnPrompt: string }
  | { kind: "fanout"; stepId: string; worker: string; units: { spawnPrompt: string }[] }
  | {
      kind: "write";
      stepId: string;
      /**
       * `label` (optional) names the result of a call so later calls in the
       * same step can reference it via `"$<label>"` string-arg substitution.
       * Per ADR-023, the orchestrator's eager-execute path owns substitution;
       * stages declare labels explicitly. Cf. A1-ingest's `insights` and
       * X3-write's `experiment`.
       */
      calls: { tool: string; args: unknown; label?: string }[];
    }
  | {
      kind: "gate";
      stepId: string;
      gate: string;
      message: string;
      /** Optional MCP read the conductor runs to detect a cleared gate.
       *  Present = passable; absent = terminal (the conductor always STOPs). */
      check?: { tool: string; args: unknown };
    }
  | { kind: "done"; message: string }
  | { kind: "halt"; stepId: string; reason: string };

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  data?: Record<string, unknown>;
}

/** Capability surface passed to `StepSpec.build`. Single allowed I/O method:
 *  `stageInput`, which persists per-unit worker-input to
 *  `orchestrator.step_results` (payload_kind = 'input') and returns the
 *  `sr_`-prefixed ref the build can embed in spawn prompts. See ADR-024
 *  for the allowed/denied list of operations inside `build`.
 */
export interface BuildContext {
  /** Stage worker-input for one unit of a fanout (or null for spawn).
   *  Idempotent on `(runId, stepId, unitIndex, 'input')`: re-plans return
   *  the same ref. The worker reads the staged input on entry via
   *  `mcp__orchestrator__read_step_result`. */
  stageInput(unitIndex: number | null, payload: unknown): Promise<string>;
}

/** Declarative spec for one step of a stage. `build` turns run state into a concrete Step.
 *  `build` MAY return a Step synchronously or a Promise<Step>; the engine
 *  awaits the return value. Async is required when the build calls
 *  `ctx.stageInput` (ADR-024).
 */
export interface StepSpec {
  id: string;
  kind: "spawn" | "fanout" | "write" | "gate";
  build: (run: RunState, ctx: BuildContext) => Promise<Step> | Step;
  // MAY be async — the C1 claim-binding verifier (ADR-030) loads the live
  // chart index to trace figures; the engine awaits the return value.
  verify?: (run: RunState, result: unknown) => VerifyResult | Promise<VerifyResult>;
}

export interface StageDefinition {
  id: RunStage;
  steps: StepSpec[];
}
