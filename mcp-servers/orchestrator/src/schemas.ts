import { z } from "zod";

/** Input shape for the `plan` tool — runId continues a run, absent mints one. */
export const PlanInputSchema = z.object({
  runId: z.string().min(1).optional(),
  args: z.string().optional(),
});

/** A claim-check ref to a row in `orchestrator.step_results`.
 *
 *  Workers persist their final output via `write_step_result` and return
 *  this shape as their final message. The conductor passes refs verbatim
 *  to `verify` / `advance`; the MCP layer resolves them server-side
 *  before calling the engine.
 *
 *  See docs/decisions/022-claim-check-worker-output.md
 */
export const StepResultRef = z.object({
  stepResultId: z.string().regex(/^sr_/),
});

/** Input shape for `verify`. `result` accepts:
 *  - a single `StepResultRef`        (spawn steps)
 *  - an array of `StepResultRef`     (fanout steps)
 *  - any inline value                 (write / gate steps — conductor-assembled MCP results)
 *
 *  Per-kind enforcement happens at the handler (mcp-servers/orchestrator/
 *  src/enforce.ts) based on the step's `kind` in the live registry.
 */
export const VerifyInputSchema = z.object({
  runId: z.string().min(1),
  stepId: z.string().min(1),
  result: z.union([StepResultRef, z.array(StepResultRef), z.unknown()]),
});

/** Input shape for `advance`. Same shape as `verify`. */
export const AdvanceInputSchema = z.object({
  runId: z.string().min(1),
  stepId: z.string().min(1),
  result: z.union([StepResultRef, z.array(StepResultRef), z.unknown()]),
});

/** Input shape for `write_step_result` — workers call this immediately
 *  before emitting their final `{stepResultId}` message.
 */
export const WriteStepResultInputSchema = z.object({
  runId: z.string().min(1),
  stepId: z.string().min(1),
  unitIndex: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});

/** Input shape for `read_step_result` — auditable opt-in transparency.
 *  Used by the conductor or any agent that needs to reason over a
 *  worker's output (failure-aware retry, meta-orchestration, debugging).
 */
export const ReadStepResultInputSchema = z.object({
  stepResultId: z.string().regex(/^sr_/),
});
