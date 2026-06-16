/**
 * Claim-binding transforms (ADR-030). The schema lives in zod.ts; this is the
 * one stateful transition: promoting a HELD gap binding to a data binding once
 * the missing chart has been authored (via /chart-gap → chart-author).
 */

export interface ClaimBinding {
  claim: string;
  kind: "data" | "qualitative" | "gap";
  chartRef: string | null;
  figures: string[];
  takeaway: string;
  gapNote: string | null;
}

export interface RebindInput {
  /** Exact claim text of the gap binding to promote. */
  claim: string;
  /** The newly-authored chart id (file stem under corpus/data/charts/). */
  chartRef: string;
  /** The figure tokens the new chart depicts (must trace to it — the caller
   *  re-runs the C1 figures-trace after rebinding). */
  figures: string[];
  /** Optional new takeaway; defaults to the gap binding's existing takeaway. */
  takeaway?: string;
}

/**
 * Promote a held `gap` binding to `data` on a Script's claimBindings.
 *
 * Pure: returns a new array, leaves the input untouched. Matches the gap
 * binding by exact claim text. Throws if no `gap` binding with that claim
 * exists — the caller must pass a real open gap (so a typo can't silently
 * no-op and leave the Script held forever). The result is a well-formed `data`
 * binding (chartRef set, gapNote cleared); the caller should re-run the C1
 * figures-trace against the authored chart before persisting.
 */
export function rebindGapToData(
  bindings: ClaimBinding[],
  input: RebindInput,
): ClaimBinding[] {
  let matched = false;
  const next = bindings.map((b): ClaimBinding => {
    if (b.kind === "gap" && b.claim === input.claim) {
      matched = true;
      return {
        ...b,
        kind: "data",
        chartRef: input.chartRef,
        figures: input.figures,
        takeaway: input.takeaway ?? b.takeaway,
        gapNote: null,
      };
    }
    return b;
  });
  if (!matched) {
    throw new Error(`rebindGapToData: no gap binding found for claim "${input.claim}"`);
  }
  return next;
}

/** Does this Script still hold any unfilled gap binding? (HG2 "Held" state.) */
export function hasOpenGap(bindings: ClaimBinding[]): boolean {
  return bindings.some((b) => b.kind === "gap");
}
