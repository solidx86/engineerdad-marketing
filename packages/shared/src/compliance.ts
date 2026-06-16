import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Lang } from "./types.js";

export interface BannedRule {
  pattern: string;
  flags?: string;
  reason: string;
  lang: Lang | "all";
  /**
   * When true, a match is suppressed if a negation token appears within
   * NEGATION_WINDOW chars before the match. Required for patterns that collide
   * with mandated disclaimer phrasings (e.g. SC §8.18 "does not amount to nor
   * indicate that the SC has recommended or endorsed"). Off by default — most
   * banned claims ("guaranteed returns", "risk-free") stay strictly literal
   * because negating them in marketing copy is still a compliance smell.
   */
  negation_aware?: boolean;
}

const NEGATION_WINDOW = 80;
const NEGATION_TOKEN_REGEX =
  /\b(not|no|never|cannot|won't|doesn['’]?t|don['’]?t|didn['’]?t|tidak|bukan|tiada|jangan)\b|(并非|並非|不是|不會|不会|没有|沒有|未曾|不|没|沒)/i;

function isNegated(text: string, matchIndex: number, matchLength: number): boolean {
  // Scan from NEGATION_WINDOW before the match through the end of the matched
  // span itself. The canonical SC §8.18 disclaimer ("registration with SC does
  // not mean SC endorses the fund") places the negation BETWEEN the two halves
  // of an `\bsc\b.{0,30}endorses?` capture — so the negation lives inside the
  // matched substring, not before it. Including the match in the scan window
  // lets us suppress the mandated disclaimer without weakening other rules.
  const start = Math.max(0, matchIndex - NEGATION_WINDOW);
  return NEGATION_TOKEN_REGEX.test(text.slice(start, matchIndex + matchLength));
}

export interface RequiredDisclaimer {
  name: string;
  description?: string;
  patterns_per_lang: Record<Lang, string[]>;
  flags?: string;
}

export interface ComplianceRules {
  banned: BannedRule[];
  required_disclaimers: RequiredDisclaimer[];
}

export interface ComplianceViolation {
  kind: "banned" | "missing_disclaimer";
  name: string;
  reason: string;
  match?: string;
}

export interface ComplianceScanResult {
  ok: boolean;
  violations: ComplianceViolation[];
}

const DEFAULT_RULES_PATH = resolve(
  process.cwd(),
  "corpus/compliance/banned-phrases.yaml",
);

let cachedRules: { path: string; mtimeMs: number; rules: ComplianceRules } | undefined;

export function loadComplianceRules(rulesPath: string = DEFAULT_RULES_PATH): ComplianceRules {
  const mtimeMs = statSync(rulesPath).mtimeMs;
  if (cachedRules && cachedRules.path === rulesPath && cachedRules.mtimeMs === mtimeMs) {
    return cachedRules.rules;
  }
  const raw = readFileSync(rulesPath, "utf8");
  const parsed = parseYaml(raw) as ComplianceRules;
  if (!parsed || !Array.isArray(parsed.banned) || !Array.isArray(parsed.required_disclaimers)) {
    throw new Error(
      `Invalid compliance rules at ${rulesPath}: expected { banned: [], required_disclaimers: [] }`,
    );
  }
  cachedRules = { path: rulesPath, mtimeMs, rules: parsed };
  return parsed;
}

export function clearComplianceRulesCache(): void {
  cachedRules = undefined;
}

export function complianceScan(
  text: string,
  lang: Lang,
  rulesPath?: string,
): ComplianceScanResult {
  const rules = loadComplianceRules(rulesPath);
  const violations: ComplianceViolation[] = [];

  for (const rule of rules.banned) {
    if (rule.lang !== "all" && rule.lang !== lang) continue;
    const re = new RegExp(rule.pattern, rule.flags ?? "");
    const match = re.exec(text);
    if (!match) continue;
    if (rule.negation_aware && isNegated(text, match.index, match[0].length)) continue;
    violations.push({
      kind: "banned",
      name: rule.pattern,
      reason: rule.reason,
      match: match[0],
    });
  }

  for (const disc of rules.required_disclaimers) {
    const langPatterns = disc.patterns_per_lang[lang];
    if (!langPatterns || langPatterns.length === 0) {
      violations.push({
        kind: "missing_disclaimer",
        name: disc.name,
        reason: `no patterns defined for lang=${lang} on disclaimer "${disc.name}"`,
      });
      continue;
    }
    const matched = langPatterns.some((p) => new RegExp(p, disc.flags ?? "").test(text));
    if (!matched) {
      violations.push({
        kind: "missing_disclaimer",
        name: disc.name,
        reason: disc.description?.trim() ?? `required disclaimer "${disc.name}" not found`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
