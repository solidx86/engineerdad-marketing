import { store } from "@engineerdad/store";
import { complianceScan } from "@engineerdad/shared";
import * as analytics from "@engineerdad/analytics";
import * as corpus from "@engineerdad/corpus";
import * as metaAds from "@engineerdad/meta-ads";
import * as experiment from "@engineerdad/experiment";
import type { ExecDeps } from "./exec.types.js";

/**
 * Production `ExecDeps` factory — wires the live `@engineerdad/store`
 * singleton + the live `@engineerdad/shared` compliance scanner.
 *
 * The MCP server (`mcp-servers/orchestrator/src/index.ts`) calls this once
 * at module load and reuses the result for every `plan()` invocation. Tests
 * construct their own `ExecDeps` directly with mocks.
 *
 * Later phases (D–G) extend this with `analytics`, `corpus`, `metaAds`,
 * `experiment` fields as those packages are extracted.
 */
export function createLiveExecDeps(): ExecDeps {
  return {
    store,
    compliance: complianceScan,
    analytics,
    corpus,
    metaAds,
    experiment,
  };
}
