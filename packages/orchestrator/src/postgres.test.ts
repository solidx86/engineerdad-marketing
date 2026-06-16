import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  writeStepResult,
  loadPayload,
  closePostgres,
  StepResultNotFoundError,
  getOrchestratorSql,
} from "./postgres.js";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closePostgres();
});

describe("writeStepResult / loadPayload — round trip", () => {
  it("persists a payload and reads it back identically", async () => {
    const payload = { briefId: "b1", hooks: [{ en: "hi", ms: "halo" }], scripts: [] };
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "C1-fanout",
      unitIndex: 0,
      payload,
    });
    expect(id.startsWith("sr_")).toBe(true);

    const got = await loadPayload(id);
    expect(got).toEqual(payload);
  });

  it("populates size_bytes correctly", async () => {
    const payload = { x: "a".repeat(1000) };
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "S1-reason",
      payload,
    });

    const sql = getOrchestratorSql();
    const rows = await sql<{ size_bytes: number }[]>`
      SELECT size_bytes FROM orchestrator.step_results WHERE id = ${id}
    `;
    expect(rows.length).toBe(1);
    // Payload serialized as JSON should be > 1000 bytes
    expect(rows[0]!.size_bytes).toBeGreaterThan(1000);
    expect(rows[0]!.size_bytes).toBeLessThan(1100);
  });

  it("stores unit_index as null for spawn (no index)", async () => {
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "S1-reason",
      payload: { memo: "data" },
    });

    const sql = getOrchestratorSql();
    const rows = await sql<{ unit_index: number | null }[]>`
      SELECT unit_index FROM orchestrator.step_results WHERE id = ${id}
    `;
    expect(rows[0]!.unit_index).toBeNull();
  });

  it("stores unit_index as the integer for fanout", async () => {
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "C1-fanout",
      unitIndex: 3,
      payload: { briefId: "b3" },
    });

    const sql = getOrchestratorSql();
    const rows = await sql<{ unit_index: number | null }[]>`
      SELECT unit_index FROM orchestrator.step_results WHERE id = ${id}
    `;
    expect(rows[0]!.unit_index).toBe(3);
  });

  it("round-trips a large payload (~50 KB) without truncation", async () => {
    const big = { items: Array.from({ length: 500 }, (_, i) => ({ i, msg: "x".repeat(100) })) };
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: big,
    });

    const got = await loadPayload(id);
    expect(got).toEqual(big);
  });

  it("handles null and falsy payloads", async () => {
    const id1 = await writeStepResult({
      runId: "run_test",
      stepId: "test",
      payload: null,
    });
    expect(await loadPayload(id1)).toBeNull();

    const id2 = await writeStepResult({
      runId: "run_test",
      stepId: "test",
      payload: 0,
    });
    expect(await loadPayload(id2)).toBe(0);

    const id3 = await writeStepResult({
      runId: "run_test",
      stepId: "test",
      payload: "",
    });
    expect(await loadPayload(id3)).toBe("");
  });
});

describe("normalizePayload — defensive against pre-stringified payloads (E-032)", () => {
  it("unwraps a pre-stringified object so jsonb_typeof is 'object'", async () => {
    const memo = { runId: "run_x", recommendedAngles: [{ id: "RA1" }] };
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "S1-reason",
      payload: JSON.stringify(memo),
    });

    const sql = getOrchestratorSql();
    const rows = await sql<{ typ: string }[]>`
      SELECT jsonb_typeof(payload) AS typ FROM orchestrator.step_results WHERE id = ${id}
    `;
    expect(rows[0]!.typ).toBe("object");

    expect(await loadPayload(id)).toEqual(memo);
  });

  it("unwraps a pre-stringified array so jsonb_typeof is 'array'", async () => {
    const arr = [{ id: "a" }, { id: "b" }];
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "B1-write",
      payload: JSON.stringify(arr),
    });

    const sql = getOrchestratorSql();
    const rows = await sql<{ typ: string }[]>`
      SELECT jsonb_typeof(payload) AS typ FROM orchestrator.step_results WHERE id = ${id}
    `;
    expect(rows[0]!.typ).toBe("array");
    expect(await loadPayload(id)).toEqual(arr);
  });

  it("leaves a genuine scalar string payload untouched", async () => {
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "test",
      payload: "hello world",
    });
    expect(await loadPayload(id)).toBe("hello world");
  });

  it("leaves a non-JSON-looking string untouched", async () => {
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "test",
      payload: "not-json: just a string",
    });
    expect(await loadPayload(id)).toBe("not-json: just a string");
  });
});

describe("writeStepResult — payloadKind idempotency (ADR-024)", () => {
  it("returns the same id on a repeat call with same (runId, stepId, unitIndex, payloadKind)", async () => {
    const payload = { scriptId: "s1", hookBank: ["h1", "h2"] };
    const id1 = await writeStepResult({
      runId: "run_idem",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload,
      payloadKind: "input",
    });
    const id2 = await writeStepResult({
      runId: "run_idem",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload,
      payloadKind: "input",
    });
    expect(id1).toBe(id2);

    const sql = getOrchestratorSql();
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM orchestrator.step_results
      WHERE run_id = 'run_idem' AND step_id = 'P1-fanout' AND unit_index = 0
    `;
    expect(rows[0]!.count).toBe("1");
  });

  it("preserves the original payload on a re-plan (idempotency contract: re-plans do not mutate)", async () => {
    const original = { scriptId: "s1", hookBank: ["h1"] };
    const id1 = await writeStepResult({
      runId: "run_idem2",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: original,
      payloadKind: "input",
    });

    const replan = { scriptId: "s1", hookBank: ["h1", "MUTATED"] };
    const id2 = await writeStepResult({
      runId: "run_idem2",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: replan,
      payloadKind: "input",
    });
    expect(id2).toBe(id1);

    const got = await loadPayload(id1);
    expect(got).toEqual(original);
  });

  it("treats distinct unitIndex values as distinct rows under the same key", async () => {
    const id0 = await writeStepResult({
      runId: "run_idem3",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: { unit: 0 },
      payloadKind: "input",
    });
    const id1 = await writeStepResult({
      runId: "run_idem3",
      stepId: "P1-fanout",
      unitIndex: 1,
      payload: { unit: 1 },
      payloadKind: "input",
    });
    expect(id0).not.toBe(id1);
  });

  it("does NOT dedup the ADR-022 output path (payloadKind unset → fresh ULID per call)", async () => {
    const a = await writeStepResult({
      runId: "run_out",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: { creatives: [] },
    });
    const b = await writeStepResult({
      runId: "run_out",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: { creatives: [] },
    });
    expect(a).not.toBe(b);
  });

  it("persists payload_kind = 'input' for tagged rows", async () => {
    const id = await writeStepResult({
      runId: "run_tag",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: { x: 1 },
      payloadKind: "input",
    });
    const sql = getOrchestratorSql();
    const rows = await sql<{ payload_kind: string | null }[]>`
      SELECT payload_kind FROM orchestrator.step_results WHERE id = ${id}
    `;
    expect(rows[0]!.payload_kind).toBe("input");
  });

  it("persists payload_kind = NULL for untagged rows (ADR-022 path)", async () => {
    const id = await writeStepResult({
      runId: "run_untag",
      stepId: "P1-fanout",
      unitIndex: 0,
      payload: { x: 1 },
    });
    const sql = getOrchestratorSql();
    const rows = await sql<{ payload_kind: string | null }[]>`
      SELECT payload_kind FROM orchestrator.step_results WHERE id = ${id}
    `;
    expect(rows[0]!.payload_kind).toBeNull();
  });
});

describe("loadPayload — missing id", () => {
  it("throws StepResultNotFoundError with the id attached", async () => {
    const missingId = "sr_01ABCDEFGHIJKLMNOPQRSTUVWX";
    await expect(loadPayload(missingId)).rejects.toThrow(StepResultNotFoundError);
    try {
      await loadPayload(missingId);
    } catch (e) {
      expect(e).toBeInstanceOf(StepResultNotFoundError);
      expect((e as StepResultNotFoundError).stepResultId).toBe(missingId);
    }
  });
});

it("exports a singleton sql client", () => {
  expect(typeof getOrchestratorSql).toBe("function");
});
