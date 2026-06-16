import type { StageDefinition, StepSpec } from "@engineerdad/orchestrator";
import { isRef, isRefArray } from "./resolve.js";

/** Find a `StepSpec` across every stage in the registry. */
function findStepSpec(registry: StageDefinition[], stepId: string): StepSpec | undefined {
  for (const stage of registry) {
    const spec = stage.steps.find((s) => s.id === stepId);
    if (spec) return spec;
  }
  return undefined;
}

/** Thrown when the result shape doesn't match the step's kind contract.
 *  The MCP `verify` handler surfaces this as `{ok: false, problems: [...]}`;
 *  `advance` surfaces it as an MCP error response.
 */
export class ContractError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ContractError";
  }
}

/** Reject inline payloads on `spawn` and `fanout` steps; accept anything
 *  on `write` and `gate` (their results are conductor-assembled MCP-call
 *  arrays / server-side read results, not worker output).
 *
 *  Per E-031 / ADR-022 — claim-check is mandatory for worker-output
 *  steps; the contract is enforced here so an honest mistake by the
 *  conductor surfaces immediately, not silently corrupts run state.
 */
export function enforceKind(
  stepId: string,
  result: unknown,
  registry: StageDefinition[],
): void {
  const spec = findStepSpec(registry, stepId);
  if (!spec) {
    throw new ContractError(`unknown stepId: ${stepId}`);
  }

  if (spec.kind === "spawn") {
    if (!isRef(result)) {
      throw new ContractError(
        `spawn step ${stepId} requires a {stepResultId} ref; got inline payload`,
      );
    }
    return;
  }

  if (spec.kind === "fanout") {
    if (!isRefArray(result)) {
      throw new ContractError(
        `fanout step ${stepId} requires [{stepResultId}, ...] non-empty ref array; got non-ref shape`,
      );
    }
    return;
  }

  // write + gate: inline is fine; no check
}
