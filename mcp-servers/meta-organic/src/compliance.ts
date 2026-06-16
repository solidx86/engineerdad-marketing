/**
 * Compliance pre-flight for organic posts (per spec §10 / ADR-019).
 *
 * Wraps the shared `complianceScan` scanner (sc-malaysia / fimm / public-mutual
 * banned-phrase rules from corpus/compliance/banned-phrases.yaml) and throws a
 * hard `compliance_block` error on any violation. Fails closed — no violations
 * are silently swallowed.
 */
import { complianceScan } from "@engineerdad/shared";
import type { Lang } from "@engineerdad/shared";

export interface PreflightArgs {
  caption: string;
  /** BCP-47 language of the caption. Required — callers must declare "en" or "ms". */
  lang: Lang;
}

/**
 * Runs the corpus compliance scanner over the organic caption.
 * Throws `compliance_block: <details>` if any banned phrase is matched
 * or a required disclaimer is missing.
 */
export function preflightCompliance(args: PreflightArgs): void {
  const result = complianceScan(args.caption, args.lang);
  if (!result.ok) {
    const details = result.violations
      .map((v) => `${v.name} — ${v.reason}`)
      .join("; ");
    throw new Error(`compliance_block: ${details}`);
  }
}
