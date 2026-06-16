import type { VerifyResult } from "../types.js";
import { tracesTo, parseFigure, approxEqual } from "@engineerdad/shared";

/**
 * The content-stage acceptance test. After E-027, this accepts both shapes:
 *
 *   • a canonical ContentResult `{ scripts, hookBanks }` — the legacy
 *     single-spawn path; and
 *   • an array of per-Brief worker outputs from a C1-fanout — each
 *     `{ briefId, hooks, scripts, … }`. Per-unit checks run on each member;
 *     the union proof ratio is re-checked as defence in depth.
 *
 * The §8 Piliero rule (≥30 hooks across all 6 emotional registers, ≥3 each)
 * runs on the real `hooks[]` array, never a self-reported summary — an agent
 * that under-delivers (or mis-reports) must still fail here.
 */

export interface HookEntry {
  en?: unknown;
  ms?: unknown;
  register?: unknown;
}

export interface HookBankEntry {
  briefId?: unknown;
  hooks?: unknown;
}

export interface ContentResult {
  scripts?: unknown;
  hookBanks?: unknown;
  proofRatio?: unknown;
}

export interface ContentUnit {
  briefId?: unknown;
  hooks?: unknown;
  scripts?: unknown;
}

const REQUIRED_REGISTERS = [
  "fear",
  "aspiration",
  "curiosity",
  "proof",
  "contrarian",
  "identity",
] as const;

const MIN_HOOKS = 30;
const MIN_PER_REGISTER = 3;
const MIN_PROOF_RATIO = 0.8;

/** Append §8 Piliero violations of one hook bank to `problems`.
 *  `bank` may be either a HookBankEntry or a ContentUnit (which also has `hooks`). */
function verifyHookBank(bank: unknown, label: string, problems: string[]): void {
  if (bank === null || typeof bank !== "object") {
    problems.push(`${label} is not a hook-bank object`);
    return;
  }
  const hooks = (bank as HookBankEntry).hooks;
  if (!Array.isArray(hooks)) {
    problems.push(`${label} has no hooks array`);
    return;
  }

  const counts: Record<string, number> = {};
  for (const hook of hooks) {
    if (hook !== null && typeof hook === "object") {
      const register = (hook as HookEntry).register;
      if (typeof register === "string") counts[register] = (counts[register] ?? 0) + 1;
    }
  }
  const countOf = (r: string): number => counts[r] ?? 0;

  const missing = REQUIRED_REGISTERS.filter((r) => countOf(r) <= 0);
  if (missing.length > 0) {
    problems.push(`${label} hook bank missing register(s): ${missing.join(", ")}`);
  }

  const thin = REQUIRED_REGISTERS.filter((r) => {
    const c = countOf(r);
    return c > 0 && c < MIN_PER_REGISTER;
  });
  if (thin.length > 0) {
    problems.push(
      `${label} hook bank has register(s) below ${MIN_PER_REGISTER} hooks: ` +
        thin.map((r) => `${r} (${countOf(r)})`).join(", "),
    );
  }

  if (hooks.length < MIN_HOOKS) {
    problems.push(
      `${label} hook bank has ${hooks.length} hooks — below the ${MIN_HOOKS}-hook minimum (§8 Piliero rule)`,
    );
  }
}

function proofRatioOf(scripts: unknown): { withProof: number; total: number; ratio: number } {
  if (!Array.isArray(scripts) || scripts.length === 0) return { withProof: 0, total: 0, ratio: 1 };
  let withProof = 0;
  for (const s of scripts) {
    if (s !== null && typeof s === "object") {
      const refs = (s as { proofRefs?: unknown }).proofRefs;
      if (Array.isArray(refs) && refs.length > 0) withProof++;
    }
  }
  return { withProof, total: scripts.length, ratio: withProof / scripts.length };
}

/** Validate one C1-fanout worker's output (one Brief). */
export function verifyContentUnit(unit: unknown): VerifyResult {
  if (unit === null || typeof unit !== "object") {
    return { ok: false, problems: ["content unit is not an object"] };
  }
  const { briefId, scripts } = unit as ContentUnit;
  const label = typeof briefId === "string" ? `Brief ${briefId}` : "unit";
  const problems: string[] = [];

  verifyHookBank(unit, label, problems);

  if (!Array.isArray(scripts) || scripts.length === 0) {
    problems.push(`${label} authored no scripts`);
  } else {
    const { ratio, withProof, total } = proofRatioOf(scripts);
    if (ratio < MIN_PROOF_RATIO) {
      problems.push(
        `${label} proof ratio ${withProof}/${total} = ${ratio.toFixed(2)} — below the ${MIN_PROOF_RATIO} per-Brief minimum`,
      );
    }
  }

  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}

/** The content-stage acceptance test — accepts both legacy and fanout shapes. */
export function verifyContent(result: unknown): VerifyResult {
  if (Array.isArray(result)) return verifyContentArray(result);

  if (result === null || typeof result !== "object") {
    return { ok: false, problems: ["content-writer produced no result"] };
  }
  const { scripts, hookBanks } = result as ContentResult;
  const problems: string[] = [];

  if (!Array.isArray(scripts) || scripts.length === 0) {
    problems.push("content-writer authored no scripts");
  }

  if (!Array.isArray(hookBanks) || hookBanks.length === 0) {
    problems.push("content-writer emitted no hook banks");
  } else {
    hookBanks.forEach((bank, i) => {
      const briefId =
        bank !== null && typeof bank === "object"
          ? (bank as HookBankEntry).briefId
          : undefined;
      const label = typeof briefId === "string" ? `Brief ${briefId}` : `hook bank #${i + 1}`;
      verifyHookBank(bank, label, problems);
    });
  }

  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}

function verifyContentArray(units: unknown[]): VerifyResult {
  if (units.length === 0) {
    return { ok: false, problems: ["C1-fanout produced no per-Brief units"] };
  }
  const problems: string[] = [];
  const allScripts: unknown[] = [];
  for (const u of units) {
    const r = verifyContentUnit(u);
    if (!r.ok) problems.push(...r.problems);
    if (u !== null && typeof u === "object") {
      const scripts = (u as ContentUnit).scripts;
      if (Array.isArray(scripts)) allScripts.push(...scripts);
    }
  }
  const { ratio, withProof, total } = proofRatioOf(allScripts);
  if (total > 0 && ratio < MIN_PROOF_RATIO) {
    problems.push(
      `union proof ratio ${withProof}/${total} = ${ratio.toFixed(2)} — below ${MIN_PROOF_RATIO}`,
    );
  }
  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}

// ── Claim-binding verifier (ADR-030, C1 enforcement layer) ─────────────────
//   HARD (fails the stage): every kind:data binding must name a REAL chart and
//   every one of its figures must trace to a number that chart depicts — this
//   is the B-038 guard (a chart whose numbers don't match the claim) and the
//   invented-number guard. The chart index is INJECTED (id → traceNumbers) so
//   this stays a pure, testable function; the stage loads the live charts.
//
//   SOFT (flags to HG2 via `data.flags`, does not fail): every financial token
//   that appears in a binding's `claim` text must also be listed in that
//   binding's `figures[]` — otherwise the chart-trace silently validated fewer
//   numbers than the claim asserts. (Full script-body coverage is enforced by
//   the content-writer internal QA and re-checked at P1 over the produce specs,
//   which — unlike the C1 payload — carry the rendered on-frame text.)

/** chartId → the canonical numbers that chart depicts (ChartMetadata.traceNumbers). */
export type ChartIndex = Map<string, number[]>;

// RM-prefixed, %-suffixed, or magnitude-suffixed (k/M/juta/ribu) — the tokens
// that assert a financial figure. Bare integers (ages, years, counts) are
// incidental and intentionally NOT required to trace.
const FINANCIAL_TOKEN =
  /RM\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?|\d[\d,]*(?:\.\d+)?\s?%|\d[\d,]*(?:\.\d+)?\s?(?:k|K|M|juta|ribu)\b/g;

interface ScriptBindings {
  label: string;
  bindings: unknown[];
}

/** Collect each script's claimBindings from either C1 shape (fanout unit array
 *  or a folded ContentResult), with a human-readable label. */
function collectScriptBindings(result: unknown): ScriptBindings[] {
  const out: ScriptBindings[] = [];
  const pushScripts = (scripts: unknown, ctx: string): void => {
    if (!Array.isArray(scripts)) return;
    scripts.forEach((s, i) => {
      if (s === null || typeof s !== "object") return;
      const id = (s as { id?: unknown }).id;
      const cb = (s as { claimBindings?: unknown }).claimBindings;
      out.push({
        label: `${ctx} script ${typeof id === "string" ? id : `#${i + 1}`}`,
        bindings: Array.isArray(cb) ? cb : [],
      });
    });
  };
  if (Array.isArray(result)) {
    result.forEach((u, i) => {
      if (u === null || typeof u !== "object") return;
      const briefId = (u as { briefId?: unknown }).briefId;
      pushScripts(
        (u as { scripts?: unknown }).scripts,
        typeof briefId === "string" ? `Brief ${briefId}` : `unit #${i + 1}`,
      );
    });
  } else if (result !== null && typeof result === "object") {
    pushScripts((result as { scripts?: unknown }).scripts, "result");
  }
  return out;
}

/** C1 claim-binding check. `charts` is the injected live chart index. */
export function verifyClaimBindings(result: unknown, charts: ChartIndex): VerifyResult {
  const problems: string[] = [];
  const flags: string[] = [];

  for (const { label, bindings } of collectScriptBindings(result)) {
    bindings.forEach((b, i) => {
      if (b === null || typeof b !== "object") {
        problems.push(`${label}: claim binding #${i + 1} is not an object`);
        return;
      }
      const kind = (b as { kind?: unknown }).kind;
      const claim = typeof (b as { claim?: unknown }).claim === "string"
        ? ((b as { claim: string }).claim)
        : "";
      const chartRef = (b as { chartRef?: unknown }).chartRef;
      const figuresRaw = (b as { figures?: unknown }).figures;
      const figures = Array.isArray(figuresRaw)
        ? figuresRaw.filter((f): f is string => typeof f === "string")
        : [];
      const bl = `${label}: claim "${claim.slice(0, 60)}${claim.length > 60 ? "…" : ""}"`;

      // HARD — data bindings must trace to a real chart.
      if (kind === "data") {
        if (typeof chartRef !== "string" || chartRef.length === 0) {
          problems.push(`${bl} is kind:data but has no chartRef`);
        } else {
          const haystack = charts.get(chartRef);
          if (!haystack) {
            problems.push(
              `${bl} binds chartRef "${chartRef}" — not a real chart in corpus/data/charts/`,
            );
          } else {
            if (figures.length === 0) {
              problems.push(`${bl} is kind:data but lists no figures to trace`);
            }
            for (const fig of figures) {
              if (!tracesTo(fig, haystack)) {
                problems.push(
                  `${bl} figure "${fig}" does not trace to any number in chart "${chartRef}" (B-038 guard)`,
                );
              }
            }
          }
        }
      }

      // SOFT — financial tokens in the claim text must be listed in figures[].
      if (kind === "data" || kind === "gap") {
        const figNums = figures
          .map(parseFigure)
          .filter((n): n is number => n !== null);
        for (const tok of claim.match(FINANCIAL_TOKEN) ?? []) {
          const v = parseFigure(tok);
          if (v === null) continue;
          if (!figNums.some((n) => approxEqual(v, n))) {
            flags.push(
              `${bl} asserts "${tok.trim()}" but it is absent from the binding's figures[] — the chart-trace did not validate it`,
            );
          }
        }
      }
    });
  }

  const res: VerifyResult = { ok: problems.length === 0, problems };
  if (flags.length > 0) res.data = { flags };
  return res;
}

/** Fold a C1-fanout's per-unit array into a ContentResult for downstream readers. */
export function foldContentUnits(units: unknown[]): ContentResult {
  const scripts: unknown[] = [];
  const hookBanks: { briefId: unknown; hooks: unknown }[] = [];
  for (const u of units) {
    if (u === null || typeof u !== "object") continue;
    const unit = u as ContentUnit;
    if (Array.isArray(unit.scripts)) scripts.push(...unit.scripts);
    if (Array.isArray(unit.hooks)) hookBanks.push({ briefId: unit.briefId, hooks: unit.hooks });
  }
  const { ratio } = proofRatioOf(scripts);
  return { scripts, hookBanks, proofRatio: ratio };
}
