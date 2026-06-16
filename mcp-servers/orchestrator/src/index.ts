#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  verify,
  advance,
  listRuns,
  LIVE_REGISTRY,
  writeStepResult,
  loadPayload,
  StepResultNotFoundError,
  createLiveExecDeps,
} from "@engineerdad/orchestrator";
import { runEagerLoop } from "./eager.js";
import {
  PlanInputSchema,
  VerifyInputSchema,
  AdvanceInputSchema,
  WriteStepResultInputSchema,
  ReadStepResultInputSchema,
} from "./schemas.js";
import { coerceResult } from "./coerce.js";
import { resolveRefs } from "./resolve.js";
import { enforceKind, ContractError } from "./enforce.js";

const server = new McpServer({ name: "orchestrator", version: "0.1.0" });

const toolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});
const errorResult = (err: unknown) => ({
  isError: true,
  content: [
    { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
  ],
});

/**
 * `ExecDeps` for the eager-execute path (ADR-023). Constructed once at
 * module load — the live store singleton + the live compliance scanner.
 * Phase B wires store-only dispatch; Phase D–G extend with analytics /
 * corpus / meta-ads / experiment as those packages graduate.
 */
const EXEC_DEPS = createLiveExecDeps();

server.tool(
  "plan",
  "Continue a run, or mint a new one when runId is absent. Per ADR-023 the orchestrator self-executes write steps and gate-checks inside this handler before returning, so the conductor only ever sees spawn / fanout / terminal-gate / done / halt kinds. Returns { runId, step } — the next conductor-relevant Step.",
  PlanInputSchema.shape,
  async (args) => {
    try {
      return toolResult(
        await runEagerLoop({ runId: args.runId, args: args.args }, LIVE_REGISTRY, EXEC_DEPS),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "verify",
  "Run a step's acceptance test against a worker result. For spawn/fanout steps `result` must be a claim-check ref ({stepResultId}) or an array of refs — inline payloads are rejected per ADR-022. Returns { ok, problems }.",
  VerifyInputSchema.shape,
  async (args) => {
    try {
      const coerced = coerceResult(args.result);
      enforceKind(args.stepId, coerced, LIVE_REGISTRY);
      const resolved = await resolveRefs(coerced);
      return toolResult(await verify(args.runId, args.stepId, resolved, LIVE_REGISTRY));
    } catch (err) {
      if (err instanceof ContractError || err instanceof StepResultNotFoundError) {
        return toolResult({ ok: false, problems: [err.message] });
      }
      return errorResult(err);
    }
  },
);

server.tool(
  "advance",
  "Mark a step done with its result and roll the stage forward when its last step completes. For spawn/fanout `result` must be claim-check ref(s) per ADR-022. Returns the run's new { stage, status }.",
  AdvanceInputSchema.shape,
  async (args) => {
    try {
      const coerced = coerceResult(args.result);
      enforceKind(args.stepId, coerced, LIVE_REGISTRY);
      const resolved = await resolveRefs(coerced);
      return toolResult(await advance(args.runId, args.stepId, resolved, LIVE_REGISTRY));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "status",
  "List every run with its stage, status, and step count — the /status dashboard.",
  {},
  async () => {
    try {
      return toolResult({ runs: await listRuns() });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "write_step_result",
  "Persist a worker's final output to orchestrator.step_results (Postgres). Workers MUST call this before emitting their final {stepResultId} message — see ADR-022. Returns { stepResultId } where the id is a typed-prefix ULID ('sr_...').",
  WriteStepResultInputSchema.shape,
  async (args) => {
    try {
      const id = await writeStepResult({
        runId: args.runId,
        stepId: args.stepId,
        unitIndex: args.unitIndex,
        payload: args.payload,
      });
      return toolResult({ stepResultId: id });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "read_step_result",
  "Auditable opt-in transparency — fetch a worker's persisted output by stepResultId. Reserved for failure-aware retry, meta-orchestration, debugging — NOT for normal transmission (the conductor passes refs verbatim to verify/advance). See ADR-022.",
  ReadStepResultInputSchema.shape,
  async (args) => {
    try {
      const payload = await loadPayload(args.stepResultId);
      return toolResult({ payload });
    } catch (err) {
      if (err instanceof StepResultNotFoundError) {
        return errorResult(err);
      }
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
