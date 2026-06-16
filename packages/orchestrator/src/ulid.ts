import { ulid } from "ulid";

/** Length of the `sr_` prefix + 26-char ULID body. */
const STEP_RESULT_ID_LEN = 29;

/** A typed-prefix ULID for `orchestrator.step_results` rows.
 *
 *  Format: `"sr_" + 26-char ULID`.
 *  The prefix is greppable in logs and prevents accidental cross-type
 *  passes (e.g. confusing a Brief id with a step-result id). The 26-char
 *  ULID body is sortable by creation time and collision-safe at high
 *  rates.
 */
export function newStepResultId(): string {
  return `sr_${ulid()}`;
}

/** Type guard for step-result ids — checks shape, not existence in the
 *  store. Use this in MCP handlers that need to detect the claim-check
 *  shape before resolving.
 */
export function isStepResultId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === STEP_RESULT_ID_LEN &&
    value.startsWith("sr_")
  );
}
