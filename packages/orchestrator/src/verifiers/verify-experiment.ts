import type { VerifyResult } from "../types.js";
import type { AllocatedCell } from "../experiment/allocation.js";
import { classifyExperimentStatus, type ExperimentStatus } from "@engineerdad/shared";

/**
 * Tri-state acceptance test. `full` / `degraded` / `single-cell` all pass;
 * `broken` (zero occupied cells) fails. The status is carried in `data` so
 * X3-write can persist it without recomputing. Allocation arithmetic is
 * still required to sum to 100.
 *
 * Contract: `data.experimentStatus` is populated ONLY on code paths that
 * reach the classification step. Pre-classification failures
 * (`experimentRowCreated === false`, `cells.length === 0`) return without
 * `data`. Downstream consumers that read `data.experimentStatus` should
 * only do so on `ok: true` returns — X3-write only runs after verify
 * passes, so this is safe by control flow.
 *
 * Spec: docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html §3.2
 */
export function verifyExperiment(
  cells: AllocatedCell[],
  experimentRowCreated: boolean,
): VerifyResult {
  const problems: string[] = [];

  if (!experimentRowCreated) {
    problems.push("Experiment row was not created");
    return { ok: false, problems };
  }

  if (cells.length === 0) {
    problems.push("experiment design produced no cells");
    return { ok: false, problems };
  }

  const occupied = cells.filter((c) => c.variantPageIds.length > 0).length;
  const experimentStatus: ExperimentStatus = classifyExperimentStatus({
    occupied,
    total: cells.length,
  });

  if (experimentStatus === "broken") {
    problems.push("all cells empty: no approved variants mapped to any cell");
  }

  const sum = cells.reduce((a, c) => a + c.allocationPct, 0);
  if (Math.abs(sum - 100) > 0.5) {
    problems.push(`allocation sums to ${sum}, expected 100`);
  }

  return { ok: problems.length === 0, problems, data: { experimentStatus } };
}
