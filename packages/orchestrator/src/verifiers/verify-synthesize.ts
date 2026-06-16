import type { VerifyResult } from "../types.js";

/**
 * Synthesize-stage acceptance test. Two layers:
 *
 *   (1) The memo must declare recommendedAngles[] non-empty (existing).
 *   (2) When the memo carries experimentParams, the block must be shape-correct
 *       (new). Absent block = legitimate-skip path (Brain declined / cold-start).
 *       The experiment stage detects absence via experimentDeclined() and no-ops.
 */
export interface DecisionMemo {
  recommendedAngles?: unknown;
  experimentParams?: unknown;
}

const VALID_METRICS = new Set(["cpa", "hook_rate", "thumbstop", "ctr"]);

function verifyExperimentParams(p: unknown): string[] {
  const problems: string[] = [];
  if (p === null || typeof p !== "object") {
    return ["experimentParams must be an object"];
  }
  const o = p as Record<string, unknown>;

  if (typeof o.hypothesis !== "string" || o.hypothesis.length === 0) {
    problems.push("experimentParams.hypothesis must be a non-empty string");
  }

  if (!Array.isArray(o.factors) || o.factors.length === 0) {
    problems.push("experimentParams.factors must be a non-empty array");
  } else {
    o.factors.forEach((f, i) => {
      if (f === null || typeof f !== "object") {
        problems.push(`experimentParams.factors[${i}] must be an object`);
        return;
      }
      const fr = f as { name?: unknown; levels?: unknown };
      if (typeof fr.name !== "string" || fr.name.length === 0) {
        problems.push(`experimentParams.factors[${i}].name must be a non-empty string`);
      }
      if (!Array.isArray(fr.levels) || fr.levels.length < 2) {
        problems.push(
          `experimentParams.factors[${i}].levels must be >=2 strings (single level = no test)`,
        );
      }
    });
  }

  if (!Array.isArray(o.holdConstant)) {
    problems.push("experimentParams.holdConstant must be an array (use [] when nothing held)");
  }

  if (typeof o.primaryMetric !== "string" || !VALID_METRICS.has(o.primaryMetric)) {
    problems.push(
      `experimentParams.primaryMetric must be one of ${[...VALID_METRICS].join("|")}`,
    );
  }

  if (typeof o.dailyBudgetMyr !== "number" || o.dailyBudgetMyr <= 0) {
    problems.push("experimentParams.dailyBudgetMyr must be a positive number");
  }

  if (typeof o.durationDays !== "number" || o.durationDays <= 0) {
    problems.push("experimentParams.durationDays must be a positive number");
  }

  return problems;
}

export function verifySynthesize(memo: unknown): VerifyResult {
  if (memo === null || typeof memo !== "object") {
    return { ok: false, problems: ["synthesize produced no Decision Memo"] };
  }
  const m = memo as DecisionMemo;

  const angles = m.recommendedAngles;
  if (!Array.isArray(angles) || angles.length === 0) {
    return { ok: false, problems: ["Decision Memo carries no recommendedAngles"] };
  }

  // experimentParams is optional (cold-start escape). Validate only when present.
  if (m.experimentParams !== undefined) {
    const problems = verifyExperimentParams(m.experimentParams);
    if (problems.length > 0) return { ok: false, problems };
  }

  return { ok: true, problems: [] };
}
