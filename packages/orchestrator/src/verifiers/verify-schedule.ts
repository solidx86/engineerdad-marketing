import type { ScheduleResult } from "@engineerdad/shared/derive";
import type { VerifyResult } from "../types.js";

/**
 * The schedule-stage acceptance test — pure. Every Meta-organic variant must
 * have an OrganicSlot; every Meta-paid variant must have a PaidFlight; any
 * problem assignSchedule already surfaced is carried through.
 */
export function verifySchedule(
  variants: { variantId: string; channels: string[] }[],
  result: ScheduleResult,
): VerifyResult {
  const problems: string[] = [...result.problems];
  const scheduled = new Set(result.organic.map((s) => s.variantId));
  const flighted = new Set(result.paid.map((f) => f.variantId));

  for (const v of variants) {
    if (v.channels.includes("Meta-organic") && !scheduled.has(v.variantId)) {
      problems.push(`${v.variantId}: Meta-organic variant has no organic slot`);
    }
    if (v.channels.includes("Meta-paid") && !flighted.has(v.variantId)) {
      problems.push(`${v.variantId}: Meta-paid variant has no paid flight`);
    }
  }
  return { ok: problems.length === 0, problems };
}
