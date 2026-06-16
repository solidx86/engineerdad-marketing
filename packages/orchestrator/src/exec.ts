import type { Step } from "./types.js";
import type { ExecDeps, ExecResult } from "./exec.types.js";
import { UnknownSubstitutionLabelError } from "./exec.types.js";
import { getHandler } from "./exec.dispatch.js";

const SUB_PATTERN = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;

/**
 * Substitute `"$<label>"` and `"$<label>.path.to.field"` string-arg
 * references with values captured by earlier calls in the same step.
 *
 * Rules (ADR-023):
 * - A string value `"$insights"` is replaced wholesale with the captured
 *   value — substitution is value-level, not template interpolation. We do
 *   not splice the label inside larger strings.
 * - Dot-paths walk into the captured value: `"$insights.rows"` resolves to
 *   `captured.get("insights").rows`. Multi-segment paths
 *   (`"$result.data.items"`) walk in order. This matches what the legacy
 *   LLM conductor did implicitly when receiving wrapped MCP responses like
 *   `{rows: [...]}` and threading them into downstream call args.
 * - Recurse into objects and arrays so nested args like `{ rows: "$insights.rows" }`
 *   resolve correctly.
 * - An unknown label is a stage-definition bug, not a runtime recoverable
 *   condition — throw `UnknownSubstitutionLabelError`.
 */
function substitute(args: unknown, captured: Map<string, unknown>): unknown {
  if (typeof args === "string") {
    const m = SUB_PATTERN.exec(args);
    if (!m) return args;
    const label = m[1]!;
    const path = m[2] ?? "";
    if (!captured.has(label)) throw new UnknownSubstitutionLabelError(label);
    let value: unknown = captured.get(label);
    if (path) {
      const segments = path.slice(1).split("."); // drop leading "."
      for (const seg of segments) {
        if (value === null || value === undefined || typeof value !== "object") {
          throw new UnknownSubstitutionLabelError(`${label}${path}`);
        }
        value = (value as Record<string, unknown>)[seg];
      }
    }
    return value;
  }
  if (Array.isArray(args)) {
    return args.map((v) => substitute(v, captured));
  }
  if (args !== null && typeof args === "object") {
    // Only recurse into plain object literals. Boxed instances (Date, Map,
    // Set, etc.) have no enumerable own properties to substitute and must
    // pass through unchanged — otherwise Object.entries returns [] and the
    // instance is silently replaced with {}, which breaks downstream codecs
    // like Drizzle's PgTimestamp.mapToDriverValue.
    const proto = Object.getPrototypeOf(args);
    if (proto !== Object.prototype && proto !== null) return args;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) out[k] = substitute(v, captured);
    return out;
  }
  return args;
}

/**
 * Execute a `kind:"write"` step's calls sequentially against the dispatch
 * table. Captures labelled results so later calls' `$<label>` args can
 * reference them.
 *
 * Returns the array of per-call results, matching today's conductor contract
 * for the `result` arg of `mcp__orchestrator__verify` / `__advance`. The
 * engine + verifiers stay unchanged.
 *
 * Throws `UnsupportedToolError` if any call references a tool the dispatch
 * table doesn't know about — the MCP `plan()` handler catches this and
 * falls back to returning the inline step (legacy path).
 */
export async function executeWriteStep(
  step: Extract<Step, { kind: "write" }>,
  deps: ExecDeps,
): Promise<ExecResult> {
  const results: unknown[] = [];
  const captured = new Map<string, unknown>();

  for (let i = 0; i < step.calls.length; i++) {
    const call = step.calls[i]!;
    const handler = getHandler(call.tool);
    const resolvedArgs = substitute(call.args, captured);
    const result = await handler(resolvedArgs, deps);
    // Surface `{ ok: false, problems: [...] }` results (today: store.create /
    // store.update under a failed compliance scan; tomorrow: any tool that
    // ships a CRUD-like envelope). Silently appending them to `results` lets
    // the step "succeed" while leaving a hole in downstream state — exactly
    // the failure mode that orphaned 2 Reels on run_1779779169 (2026-05-26).
    if (
      result !== null &&
      typeof result === "object" &&
      (result as { ok?: unknown }).ok === false
    ) {
      const r = result as { problems?: unknown };
      const problems = Array.isArray(r.problems) ? r.problems.join("; ") : "no problems given";
      throw new Error(`${call.tool} (call ${i}) failed: ${problems}`);
    }
    results.push(result);
    if (call.label) captured.set(call.label, result);
  }

  return results;
}

/**
 * Execute a single `gate.check` read. Same dispatch path as `executeWriteStep`
 * but returns the single result (not wrapped in an array) — that's what the
 * verifier and `engine.verify` expect for the gate-check shape.
 */
export async function executeCheck(
  check: { tool: string; args: unknown },
  deps: ExecDeps,
): Promise<unknown> {
  const handler = getHandler(check.tool);
  return handler(check.args, deps);
}
