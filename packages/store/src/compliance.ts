import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { complianceScan } from "@engineerdad/shared";
import type { EntityName } from "./schema.js";
import type { ComplianceResult } from "./crud.js";

const BM_SUFFIXES = ["Bm", "Ms"];

// Resolve the compliance rules path relative to this file, not process.cwd(),
// so vitest (CWD=packages/store) and consumers in other packages all hit the
// same repo-root corpus file.
const RULES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../corpus/compliance/banned-phrases.yaml",
);

function langOf(field: string): "en" | "ms" {
  return BM_SUFFIXES.some((s) => field.endsWith(s)) ? "ms" : "en";
}

// Entities exempt from per-field banned-phrase scanning at write-time.
// - PerformanceReports: brain-authored analytical content that may reference
//   banned phrasing while diagnosing it (e.g. self-critique citing copy that
//   tripped the scanner).
// - Distributions: append-only event log; rows record routing attempts +
//   verification outcomes including raw MCP error messages that may quote
//   ad-copy text. Logging must never be blocked by content filters.
const EXEMPT_ENTITIES: ReadonlySet<EntityName> = new Set<EntityName>([
  "PerformanceReports",
  "Distributions",
]);

export async function scanProps(
  entity: EntityName,
  props: Record<string, unknown>,
): Promise<ComplianceResult> {
  if (EXEMPT_ENTITIES.has(entity)) {
    return { ok: true, problems: [] };
  }
  const problems: string[] = [];
  for (const [field, value] of Object.entries(props)) {
    if (typeof value !== "string" || value.length === 0) continue;
    const r = complianceScan(value, langOf(field), RULES_PATH);
    // Per-field write-time only hard-blocks on banned phrases. Required-disclaimer
    // checks fire at ad-assembly time (the final caption must carry them) — not on
    // every Brief / Script / Article field, which would block any short string.
    for (const v of r.violations) {
      if (v.kind !== "banned") continue;
      const detail = v.match ? `${v.reason} ("${v.match}")` : v.reason;
      problems.push(`${field}: ${detail}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
