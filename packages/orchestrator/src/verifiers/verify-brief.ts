import type { VerifyResult } from "../types.js";

/**
 * The brief-stage acceptance test.
 *
 * Structural: at least one Brief was produced.
 *
 * Taxonomy: if Brain emitted recommendedAngles (the canonical angle keys
 * for the run), every Brief's angle MUST appear in that set verbatim.
 * Off-taxonomy angles fail closed. Absent / empty recommendedAngles =
 * cold-start legitimate-skip path (Brain didn't pin an angle taxonomy).
 *
 * Spec: docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html §3.1.3
 */
export interface BriefResult {
  angles?: unknown;
}

export function verifyBrief(
  result: unknown,
  recommendedAngles?: string[],
): VerifyResult {
  if (result === null || typeof result !== "object") {
    return { ok: false, problems: ["brief-writer produced no result"] };
  }
  const angles = (result as BriefResult).angles;
  if (!Array.isArray(angles) || angles.length === 0) {
    return { ok: false, problems: ["brief-writer created no Brief angles"] };
  }

  // Skip-when-absent: cold-start legitimate-skip path.
  if (!Array.isArray(recommendedAngles) || recommendedAngles.length === 0) {
    return { ok: true, problems: [] };
  }

  const allowed = new Set(recommendedAngles);
  const problems: string[] = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const angleStr =
      typeof a === "string"
        ? a
        : typeof a === "object" && a !== null
        ? (a as { angle?: unknown }).angle
        : undefined;
    if (typeof angleStr !== "string") {
      problems.push(`angle[${i}]: not a string`);
      continue;
    }
    if (!allowed.has(angleStr)) {
      problems.push(`angle[${i}] "${angleStr}" not in recommendedAngles`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, problems: [] };
}
