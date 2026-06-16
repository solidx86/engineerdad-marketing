/**
 * Numeric normalisation for the data-first claim-binding figures-trace
 * (ADR-030). A "figure" is a literal token as written in a Script claim —
 * "RM1.2M", "41%", "age 60", "RM2,000/mo", "13 years". The C1 validator must
 * prove each such figure traces to a number that actually appears in the bound
 * chart YAML (its labels, series values, or caption/source numbers).
 *
 * The hard part is that humans write the same number many ways. We collapse a
 * token to a canonical JS number so "RM1.2M" and 1_200_000 compare equal, and
 * "41%" compares against the deflation ratio 0.41 a chart caption carries.
 *
 * This module is pure (no IO). Haystack assembly — pulling numbers out of a
 * chart YAML — is the caller's job (see the chart-metadata loader).
 */

/** Magnitude suffixes. Malay "juta" = million, "ribu" = thousand. */
const MAGNITUDE: Array<[RegExp, number]> = [
  [/^b(n|illion)?$/i, 1_000_000_000],
  [/^bil$/i, 1_000_000_000],
  [/^m(n|il|illion)?$/i, 1_000_000],
  [/^juta$/i, 1_000_000],
  [/^k$/i, 1_000],
  [/^ribu$/i, 1_000],
];

/**
 * Parse the FIRST numeric occurrence in a token to its canonical value.
 * Returns null when the token carries no number.
 *
 *   "RM1.2M"     → 1_200_000
 *   "RM100,000"  → 100000
 *   "143,000"    → 143000
 *   "41%"        → 0.41
 *   "~41%"       → 0.41
 *   "age 60"     → 60
 *   "RM2,000/mo" → 2000
 *   "13 years"   → 13
 *   "5.5%"       → 0.055
 */
export function parseFigure(token: string): number | null {
  if (typeof token !== "string") return null;
  // Find the first number: optional thousands separators + optional decimal.
  const m = token.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const raw = m[0].replace(/,/g, "");
  let value = Number(raw);
  if (!Number.isFinite(value)) return null;

  // What follows the number, trimmed of separators/spaces, up to the next gap.
  const rest = token.slice((m.index ?? 0) + m[0].length).trimStart();

  // Percent → fraction. "41%" → 0.41. Catches "% " and "percent"/"peratus".
  if (/^%|^percent|^peratus/i.test(rest)) {
    return value / 100;
  }

  // Magnitude suffix immediately after the number ("1.2M", "5k", "3 juta").
  const suffix = rest.match(/^[A-Za-z]+/)?.[0] ?? "";
  for (const [re, mult] of MAGNITUDE) {
    if (re.test(suffix)) {
      value *= mult;
      break;
    }
  }
  return value;
}

/** Default relative tolerance — charts round to nearest RM1,000, and derived
 *  percentages are quoted approximately ("~41%"). 1% relative absorbs both. */
export const DEFAULT_TOLERANCE = 0.01;

/** True when |a−b| is within `tol` RELATIVE to max(|a|,|b|), with a small
 *  absolute floor so near-zero values (ratios, small counts) still match. */
export function approxEqual(a: number, b: number, tol = DEFAULT_TOLERANCE): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  // ±0.5 absorbs integer rounding (ages, years, counts) but ONLY at integer
  // scale — sub-1 ratios (percentages stored as 0.xx) must rely on `tol` alone,
  // else 41% (0.41) would wrongly match 62% (0.62).
  const absFloor = scale >= 1 ? 0.5 : 0;
  return Math.abs(a - b) <= Math.max(tol * scale, absFloor);
}

/**
 * Does a written figure trace to any number in the haystack?
 * The haystack is the set of canonical numbers a chart depicts (labels, series
 * values, caption/source numbers). Returns false for unparseable figures.
 */
export function tracesTo(
  figure: string,
  haystack: readonly number[],
  tol = DEFAULT_TOLERANCE,
): boolean {
  const target = parseFigure(figure);
  if (target === null) return false;
  return haystack.some((n) => approxEqual(target, n, tol));
}

/** Pull every parseable number out of a free-text blob (chart caption, title,
 *  source_citation) into canonical values — used to build the trace haystack. */
export function extractNumbers(text: string): number[] {
  if (typeof text !== "string") return [];
  const out: number[] = [];
  // Match each numeric run together with an optional trailing %/suffix so
  // parseFigure applies the right transform per occurrence.
  const re = /-?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|peratus|[A-Za-z]+)?/gi;
  for (const match of text.matchAll(re)) {
    const v = parseFigure(match[0]);
    if (v !== null) out.push(v);
  }
  return out;
}
