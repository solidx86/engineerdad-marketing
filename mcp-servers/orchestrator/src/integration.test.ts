import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import {
  // engine
  plan,
  verify,
  advance,
  // state
  loadRunState,
  closeDb,
  // postgres
  writeStepResult,
  StepResultNotFoundError,
  // registry
  FIXTURE_REGISTRY,
} from "@engineerdad/orchestrator";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { resolveRefs } from "./resolve.js";
import { enforceKind, ContractError } from "./enforce.js";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test";
const admin = postgres(ADMIN_URL, { max: 2 });

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await admin.end({ timeout: 5 });
  await closeTruncatePg();
  await closeDb();
});

/** End-to-end claim-check exercise against the fixture registry.
 *
 * Simulates what the live MCP `verify` / `advance` handlers do for every
 * spawn / fanout step in the live registry:
 *   1. Worker persists output → `writeStepResult` returns ref id.
 *   2. Conductor wraps refs (single for spawn; array for fanout) and
 *      passes them as `result` to the MCP handler.
 *   3. Handler calls `enforceKind` (rejects shape mismatches), then
 *      `resolveRefs` (fetches the payloads), then `engine.verify` /
 *      `engine.advance` with the resolved data.
 *   4. `run_steps.result` ends up holding the fully-materialized payload —
 *      downstream `stepResult<T>()` reads work unchanged.
 */
describe("claim-check end-to-end — fixture stage (spawn steps)", () => {
  it("drives a 2-step spawn run with claim-check refs to completion", async () => {
    // ── Plan step 1 ──────────────────────────────────────────────────
    const minted = await plan({ args: "" }, FIXTURE_REGISTRY);
    const runId = minted.runId;
    expect(minted.step).toMatchObject({ kind: "spawn", stepId: "fixture-1" });

    // ── Worker persists its output ──────────────────────────────────
    const worker1Payload = { ok: true, step: "fixture-1" };
    const sr1 = await writeStepResult({
      runId,
      stepId: "fixture-1",
      payload: worker1Payload,
    });
    expect(sr1).toMatch(/^sr_/);

    // ── Conductor passes the ref verbatim ───────────────────────────
    const ref1 = { stepResultId: sr1 };

    // ── MCP handler: enforce + resolve + verify + advance ───────────
    enforceKind("fixture-1", ref1, FIXTURE_REGISTRY);
    const resolved1 = await resolveRefs(ref1);
    expect(resolved1).toEqual(worker1Payload);

    const v1 = await verify(runId, "fixture-1", resolved1, FIXTURE_REGISTRY);
    expect(v1.ok).toBe(true);
    await advance(runId, "fixture-1", resolved1, FIXTURE_REGISTRY);

    // ── `run_steps.result` must hold the resolved payload, not the ref ─
    const stateAfter1 = (await loadRunState(runId))!;
    const step1Row = stateAfter1.steps.find((s) => s.stepId === "fixture-1");
    expect(step1Row?.result).toEqual(worker1Payload);

    // ── Plan step 2 ──────────────────────────────────────────────────
    const next = await plan({ runId }, FIXTURE_REGISTRY);
    expect(next.step).toMatchObject({ kind: "spawn", stepId: "fixture-2" });

    const worker2Payload = { ok: true, step: "fixture-2" };
    const sr2 = await writeStepResult({
      runId,
      stepId: "fixture-2",
      payload: worker2Payload,
    });
    const ref2 = { stepResultId: sr2 };

    enforceKind("fixture-2", ref2, FIXTURE_REGISTRY);
    const resolved2 = await resolveRefs(ref2);
    const v2 = await verify(runId, "fixture-2", resolved2, FIXTURE_REGISTRY);
    expect(v2.ok).toBe(true);
    await advance(runId, "fixture-2", resolved2, FIXTURE_REGISTRY);

    // ── Run is done ─────────────────────────────────────────────────
    const final = (await plan({ runId }, FIXTURE_REGISTRY)).step;
    expect(final.kind).toBe("done");

    // ── orchestrator.step_results carries exactly 2 rows for this run ─
    const rows = await admin<{ id: string; step_id: string }[]>`
      SELECT id, step_id FROM orchestrator.step_results WHERE run_id = ${runId}
    `;
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.step_id).sort()).toEqual(["fixture-1", "fixture-2"]);
  });

  it("verify surfaces missing-ref as a typed problem (contract test)", async () => {
    // The repro from ADR-022 §Consequences "Risks": if a worker fakes a ref
    // it never persisted, verify must not silently succeed — resolveRefs
    // throws StepResultNotFoundError, the MCP handler converts it to
    // {ok: false, problems: ["..."]}.
    await plan({ args: "" }, FIXTURE_REGISTRY);

    const fakeRef = { stepResultId: "sr_01FAKEFAKEFAKEFAKEFAKEFAKE" };

    // resolveRefs throws; the MCP wrapper catches and returns ok:false.
    await expect(resolveRefs(fakeRef)).rejects.toThrow(StepResultNotFoundError);
  });

  it("enforceKind rejects inline payload on a spawn step (no claim-check ref)", () => {
    expect(() =>
      enforceKind("fixture-1", { ok: true, step: "fixture-1" }, FIXTURE_REGISTRY),
    ).toThrow(ContractError);
  });
});
