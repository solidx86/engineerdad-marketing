/**
 * Compliance assertion at the MCP layer (per ADR-015).
 *
 * `create_ad_creative` runs every piece of user-visible copy through this check
 * BEFORE posting to Meta. If a required regulator phrase is missing, the create
 * call is refused — even if the calling agent thought it was compliant.
 *
 * The check is intentionally a "sentinel-phrase" match, not a semantic
 * validator: it looks for at least one canonical regulator disclaimer per
 * language. The full compliance block (loaded via mcp__corpus__get_compliance_block)
 * is many paragraphs long and would never fit in Meta's 125–500 char limits;
 * agents are expected to pick a short disclaimer line from that block and
 * include it verbatim in the ad copy.
 *
 * Failure mode: throws REFUSED — the calling agent must fetch the compliance
 * block via the corpus MCP and retry with a copy that includes one of the
 * required phrases.
 */

const REQUIRED_PHRASES_EN: readonly string[] = [
  // Securities Commission Malaysia, FIMM, Public Mutual canonical disclaimers.
  // Any one of these counts as evidence the agent consulted the compliance block.
  "past performance",
  "not guaranteed",
  "investment carries risk",
  "investments are subject to risk",
  "consult a licensed",
  "fimm",
  "securities commission",
  "public mutual",
];

const REQUIRED_PHRASES_MS: readonly string[] = [
  "prestasi lampau",
  "tidak dijamin",
  "pelaburan melibatkan risiko",
  "rujuk penasihat",
  "fimm",
  "suruhanjaya sekuriti",
  "public mutual",
];

export type ComplianceLang = "en" | "ms";

export interface ComplianceCheckInput {
  primary_text?: string;
  headline?: string;
  description?: string;
  lang: ComplianceLang;
}

export interface ComplianceCheckResult {
  ok: boolean;
  matched_phrase?: string;
  refusal_reason?: string;
}

/**
 * Returns ok=true iff at least one required regulator phrase appears in the
 * combined ad copy (case-insensitive). Returns ok=false with a refusal_reason
 * otherwise.
 */
export function checkCompliance(input: ComplianceCheckInput): ComplianceCheckResult {
  const combined = [input.primary_text, input.headline, input.description]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
    .toLowerCase();
  if (combined.length === 0) {
    return {
      ok: false,
      refusal_reason:
        "REFUSED: compliance check requires at least one of primary_text / headline / description to be non-empty.",
    };
  }
  const required = input.lang === "ms" ? REQUIRED_PHRASES_MS : REQUIRED_PHRASES_EN;
  for (const phrase of required) {
    if (combined.includes(phrase)) {
      return { ok: true, matched_phrase: phrase };
    }
  }
  return {
    ok: false,
    refusal_reason:
      `REFUSED: ad copy contains no regulator disclaimer for lang='${input.lang}'. ` +
      "Fetch the compliance block via mcp__corpus__get_compliance_block and include " +
      "one canonical disclaimer phrase (e.g., 'past performance is not guaranteed' / " +
      "'prestasi lampau tidak menjamin') in primary_text, headline, or description.",
  };
}
