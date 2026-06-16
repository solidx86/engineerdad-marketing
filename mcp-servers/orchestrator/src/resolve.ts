import { loadPayload } from "@engineerdad/orchestrator";

/** Type guard for the claim-check ref shape: `{stepResultId: "sr_..."}`. */
export function isRef(value: unknown): value is { stepResultId: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("stepResultId" in value)) return false;
  const id = (value as { stepResultId: unknown }).stepResultId;
  return typeof id === "string" && id.startsWith("sr_");
}

/** True iff `arr` is a non-empty array where every element is a ref.
 *  Used to detect the fanout shape unambiguously — a mixed array or an
 *  empty array does NOT trigger resolution.
 */
export function isRefArray(arr: unknown): arr is { stepResultId: string }[] {
  return Array.isArray(arr) && arr.length > 0 && arr.every(isRef);
}

/** Resolve a `verify` / `advance` result into the shape the engine expects.
 *
 *  - `{stepResultId}`         (spawn)        → the payload
 *  - `[{stepResultId}, ...]`  (fanout)       → an array of payloads in order
 *  - anything else            (write / gate) → pass through unchanged
 *
 *  Throws `StepResultNotFoundError` (re-export from @engineerdad/orchestrator)
 *  if any referenced row is missing.
 */
export async function resolveRefs(result: unknown): Promise<unknown> {
  if (isRef(result)) {
    return loadPayload(result.stepResultId);
  }
  if (isRefArray(result)) {
    return Promise.all(result.map((r) => loadPayload(r.stepResultId)));
  }
  return result;
}
