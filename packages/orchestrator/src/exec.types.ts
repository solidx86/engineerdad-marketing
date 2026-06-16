import type { Crud } from "@engineerdad/store";
import type { complianceScan } from "@engineerdad/shared";
import type * as analytics from "@engineerdad/analytics";
import type * as corpus from "@engineerdad/corpus";
import type * as metaAds from "@engineerdad/meta-ads";
import type * as experiment from "@engineerdad/experiment";

// Re-export `Crud` so downstream consumers (e.g. the MCP server's eager-loop
// tests) can type their mock deps without taking a direct `@engineerdad/store`
// dependency. Library boundary doctrine: types in, types out.
export type { Crud };
export type Analytics = typeof analytics;
export type Corpus = typeof corpus;
export type MetaAds = typeof metaAds;
export type Experiment = typeof experiment;

/**
 * Dependencies for the eager-execute path (ADR-023). Phase A wires `store`
 * only; later phases add `analytics`, `corpus`, `metaAds`, `experiment` as
 * `packages/<name>` extractions land.
 *
 * `compliance` is the raw banned-phrase scanner from `@engineerdad/shared`.
 * The store's CRUD already wraps this scanner internally for entity-write
 * scans, so dispatch handlers calling `store.create`/`store.update` get
 * compliance for free. The field exists on `ExecDeps` so future direct-scan
 * callers (and tests asserting invocation counts) can spy on a single
 * injection point.
 */
export interface ExecDeps {
  store: Crud;
  compliance: typeof complianceScan;
  /** Optional — present once `packages/analytics` is wired (ADR-023 Phase D).
   *  Absent means analytics tools fall through to UnsupportedToolError,
   *  triggering the legacy MCP-call path. */
  analytics?: Analytics;
  /** Optional — present once `packages/corpus` is wired (ADR-023 Phase E).
   *  No current LIVE_REGISTRY write step calls corpus tools, but the field
   *  exists so future stages can opt in without further plumbing. */
  corpus?: Corpus;
  /** Optional — present once `packages/meta-ads` is wired (ADR-023 Phase F).
   *  Used by T1-tracking (capi_test_event), T2-events (capi_send), and
   *  A1-ingest (get_insights). ADR-015 safety invariants (PAUSED-on-create,
   *  test-event-code in dev) are enforced inside the library itself —
   *  the dispatch table just forwards args. */
  metaAds?: MetaAds;
  /** Optional — present once `packages/experiment` is wired (ADR-023 Phase G).
   *  Used by X2-design. The library is pure logic; the dispatch table just
   *  forwards args. */
  experiment?: Experiment;
}

/**
 * The shape `executeWriteStep` returns and the shape today's conductor passes
 * to `mcp__orchestrator__verify` for write steps: an array of per-call
 * results, one entry per `step.calls[i]`, in order.
 */
export type ExecResult = unknown[];

/**
 * Thrown when the dispatch table has no handler for a given `tool`. The MCP
 * server's `plan()` handler catches this and falls back to returning the
 * inline step so the conductor (or, transitionally, the legacy execution
 * path) can finish the work the old way.
 */
export class UnsupportedToolError extends Error {
  constructor(public readonly tool: string) {
    super(`Unsupported tool in orchestrator exec dispatch: ${tool}`);
    this.name = "UnsupportedToolError";
  }
}

/**
 * Thrown when a `$<label>` substitution references a label that no prior call
 * in the same step captured. Bug in the stage definition, not a runtime
 * recoverable error.
 */
export class UnknownSubstitutionLabelError extends Error {
  constructor(public readonly label: string) {
    super(`Unknown $<label> substitution: $${label} (no prior call in this step captured it)`);
    this.name = "UnknownSubstitutionLabelError";
  }
}
