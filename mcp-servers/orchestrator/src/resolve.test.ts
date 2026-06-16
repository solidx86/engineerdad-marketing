import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  writeStepResult,
  StepResultNotFoundError,
  closeDb,
} from "@engineerdad/orchestrator";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { isRef, isRefArray, resolveRefs } from "./resolve.js";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

describe("isRef", () => {
  it("accepts {stepResultId: 'sr_...'}", () => {
    expect(isRef({ stepResultId: "sr_01ABCDEF0123456789ABCDEF" })).toBe(true);
  });

  it("rejects refs without sr_ prefix", () => {
    expect(isRef({ stepResultId: "01ABCDEF0123456789ABCDEF" })).toBe(false);
    expect(isRef({ stepResultId: "brief_01" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isRef(null)).toBe(false);
    expect(isRef(undefined)).toBe(false);
    expect(isRef("sr_string_only")).toBe(false);
    expect(isRef(["sr_..."])).toBe(false);
  });

  it("rejects objects without stepResultId", () => {
    expect(isRef({})).toBe(false);
    expect(isRef({ id: "sr_..." })).toBe(false);
    expect(isRef({ stepResultId: 123 })).toBe(false);
  });
});

describe("isRefArray", () => {
  it("accepts a non-empty array of refs", () => {
    expect(isRefArray([{ stepResultId: "sr_a" }, { stepResultId: "sr_b" }])).toBe(true);
  });

  it("rejects an empty array (no fanout detection on empty)", () => {
    expect(isRefArray([])).toBe(false);
  });

  it("rejects a mixed array", () => {
    expect(isRefArray([{ stepResultId: "sr_a" }, { foo: 1 }])).toBe(false);
  });

  it("rejects a non-array", () => {
    expect(isRefArray({ stepResultId: "sr_a" })).toBe(false);
    expect(isRefArray("sr_a")).toBe(false);
    expect(isRefArray(null)).toBe(false);
  });
});

describe("resolveRefs — spawn shape", () => {
  it("returns the payload for a single ref", async () => {
    const id = await writeStepResult({
      runId: "run_test",
      stepId: "S1-reason",
      payload: { memo: "decision memo content" },
    });

    const resolved = await resolveRefs({ stepResultId: id });
    expect(resolved).toEqual({ memo: "decision memo content" });
  });

  it("throws StepResultNotFoundError for a missing ref", async () => {
    await expect(
      resolveRefs({ stepResultId: "sr_01ABCDEFGHIJKLMNOPQRSTUVWX" }),
    ).rejects.toThrow(StepResultNotFoundError);
  });
});

describe("resolveRefs — fanout shape", () => {
  it("returns an array of payloads in input order", async () => {
    const id1 = await writeStepResult({
      runId: "run_test",
      stepId: "C1-fanout",
      unitIndex: 0,
      payload: { briefId: "b1", hooks: ["h1"] },
    });
    const id2 = await writeStepResult({
      runId: "run_test",
      stepId: "C1-fanout",
      unitIndex: 1,
      payload: { briefId: "b2", hooks: ["h2"] },
    });
    const id3 = await writeStepResult({
      runId: "run_test",
      stepId: "C1-fanout",
      unitIndex: 2,
      payload: { briefId: "b3", hooks: ["h3"] },
    });

    const resolved = await resolveRefs([
      { stepResultId: id1 },
      { stepResultId: id2 },
      { stepResultId: id3 },
    ]);

    expect(resolved).toEqual([
      { briefId: "b1", hooks: ["h1"] },
      { briefId: "b2", hooks: ["h2"] },
      { briefId: "b3", hooks: ["h3"] },
    ]);
  });

  it("throws StepResultNotFoundError if any ref is missing", async () => {
    const id1 = await writeStepResult({
      runId: "run_test",
      stepId: "C1-fanout",
      unitIndex: 0,
      payload: { briefId: "b1" },
    });

    await expect(
      resolveRefs([
        { stepResultId: id1 },
        { stepResultId: "sr_01MISSINGMISSINGMISSINGMI" },
      ]),
    ).rejects.toThrow(StepResultNotFoundError);
  });
});

describe("resolveRefs — pass-through", () => {
  it("returns plain strings unchanged", async () => {
    expect(await resolveRefs("plain string")).toBe("plain string");
  });

  it("returns plain objects unchanged", async () => {
    const obj = { rows: [{ id: "x" }, { id: "y" }] };
    expect(await resolveRefs(obj)).toEqual(obj);
  });

  it("returns mixed arrays (some refs, some not) unchanged", async () => {
    const mixed = [{ stepResultId: "sr_a" }, { foo: 1 }];
    expect(await resolveRefs(mixed)).toEqual(mixed);
  });

  it("returns empty arrays unchanged (no fanout detection on empty)", async () => {
    expect(await resolveRefs([])).toEqual([]);
  });

  it("returns null / undefined unchanged", async () => {
    expect(await resolveRefs(null)).toBeNull();
    expect(await resolveRefs(undefined)).toBeUndefined();
  });
});
