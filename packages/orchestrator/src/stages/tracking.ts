import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";

/**
 * The tracking stage — validates the Meta CAPI path before any spend. A pure
 * 2-step write chain: T1-canary fires a sandbox test event; T2-send fires one
 * synthetic Lead through capi_send and writes an audit breadcrumb. A verify-fail
 * on either step STOPs the conductor — that STOP *is* the loop halt (OS02:
 * "Brain must halt the loop on ok=false").
 *
 * Phase 4 ships this definition + verifiers. Phase 5 wires it into the live
 * registry as the loop's first stage.
 */

/** The first call result out of a write step's result array. */
function firstCall(result: unknown): Record<string, unknown> | undefined {
  const arr = Array.isArray(result) ? result : [];
  const head = arr[0];
  return head !== null && typeof head === "object"
    ? (head as Record<string, unknown>)
    : undefined;
}

const t1Canary: StepSpec = {
  id: "T1-canary",
  kind: "write",
  // capi_test_event takes no args — the server forces test_event_code from env,
  // so the event lands in Events Manager → Test Events, never the live pixel.
  build: (): Step => ({
    kind: "write",
    stepId: "T1-canary",
    calls: [{ tool: "mcp__meta-ads__capi_test_event", args: {} }],
  }),
  verify: (_run, result): VerifyResult => {
    const ok = firstCall(result)?.["ok"] === true;
    return ok
      ? { ok: true, problems: [] }
      : {
          ok: false,
          problems: ["CAPI canary failed — capi_test_event did not return ok:true"],
        };
  },
};

/** A synthetic Lead — PII is fake; the server hashes em/ph (OS02 step 2). */
const SYNTHETIC_LEAD = {
  event_name: "Lead",
  event_id: "tracking-test-canary",
  action_source: "website",
  event_source_url: "https://engineerdad.my/_tracking-canary",
  user_data: {
    em: ["test@engineerdad.my"],
    ph: ["+60123456789"],
    client_user_agent: "Mozilla/5.0 (EngineerDad-CAPI-Canary)",
  },
};

const t2Send: StepSpec = {
  id: "T2-send",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "T2-send",
    calls: [
      // event_time and test_event_code omitted — the server fills both.
      { tool: "mcp__meta-ads__capi_send", args: { events: [SYNTHETIC_LEAD] } },
      {
        tool: "mcp__analytics__log_event",
        args: {
          event_name: "tracking:diagnostic",
          payload: { runId: run.runId, stage: "tracking" },
        },
      },
    ],
  }),
  verify: (_run, result): VerifyResult => {
    const received = firstCall(result)?.["events_received"];
    const ok = typeof received === "number" && received > 0;
    return ok
      ? { ok: true, problems: [] }
      : {
          ok: false,
          problems: [
            `CAPI send failed — events_received was ${String(received)}, expected > 0`,
          ],
        };
  },
};

export const trackingStage: StageDefinition = {
  id: "tracking",
  steps: [t1Canary, t2Send],
};
