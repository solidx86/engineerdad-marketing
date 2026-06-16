import type { BuildContext } from "./types.js";
import { writeStepResult } from "./postgres.js";

/** Factory for the live `BuildContext` the engine passes to `StepSpec.build`.
 *
 *  ADR-024 doctrine: this is the ONLY I/O surface a `build` is permitted to
 *  reach for. Calling other MCP servers, writing entity rows, or talking to
 *  external APIs inside `build` violates ADR-024 §"Allowed inside build()".
 *
 *  The returned context closes over the active `(runId, stepId)` so a
 *  stage's build does not need to thread them through every call site.
 */
export function createBuildContext(runId: string, stepId: string): BuildContext {
  return {
    async stageInput(unitIndex, payload) {
      return writeStepResult({
        runId,
        stepId,
        unitIndex: unitIndex ?? undefined,
        payload,
        payloadKind: "input",
      });
    },
  };
}

/** Convenience for tests / stages that genuinely don't stage any input.
 *  Calling `stageInput` on this context throws — surfacing the contract
 *  violation early instead of silently writing rows the engine doesn't
 *  expect. The default engine path uses `createBuildContext`; this is
 *  only for sites that statically know they never stage. */
export function nullBuildContext(): BuildContext {
  return {
    async stageInput() {
      throw new Error(
        "nullBuildContext.stageInput called — pass a real BuildContext if the build stages input.",
      );
    },
  };
}
