import { describe, it, expect, vi } from "vitest";
import type { Crud } from "@engineerdad/store";
import { executeWriteStep, executeCheck } from "./exec.js";
import {
  UnsupportedToolError,
  UnknownSubstitutionLabelError,
  type ExecDeps,
} from "./exec.types.js";
import { complianceScan } from "@engineerdad/shared";
import type { Step } from "./types.js";

/**
 * Unit tests for the eager-execute dispatch path (ADR-023 Phase A). All store
 * methods are mocked — the integration test in `exec.integration.test.ts`
 * exercises the real Postgres path.
 */

function makeMockStore(): { store: Crud; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    create: vi.fn().mockResolvedValue({ ok: true, id: "id-1" }),
    query: vi.fn().mockResolvedValue([{ id: "row-1", title: "t" }]),
    get: vi.fn().mockResolvedValue({ id: "row-1", title: "t" }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    setStatus: vi.fn().mockResolvedValue({ ok: true }),
    count: vi.fn().mockResolvedValue(0),
  };
  return { store: spies as unknown as Crud, spies };
}

function makeDeps(): { deps: ExecDeps; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const { store, spies } = makeMockStore();
  return { deps: { store, compliance: complianceScan }, spies };
}

describe("executeWriteStep — store-only dispatch", () => {
  it("dispatches every store tool to its handler in order", async () => {
    const { deps, spies } = makeDeps();
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T-test",
      calls: [
        { tool: "mcp__store__query", args: { entity: "Briefs", filter: { runId: "r1" } } },
        { tool: "mcp__store__get", args: { entity: "Briefs", id: "b1" } },
        { tool: "mcp__store__create", args: { entity: "Briefs", props: { runId: "r1" } } },
        { tool: "mcp__store__update", args: { entity: "Briefs", id: "b1", props: { title: "x" } } },
        { tool: "mcp__store__set_status", args: { entity: "Briefs", id: "b1", status: "Approved" } },
      ],
    };
    const results = await executeWriteStep(step, deps);

    expect(results).toHaveLength(5);
    expect(spies.query).toHaveBeenCalledOnce();
    expect(spies.get).toHaveBeenCalledOnce();
    expect(spies.create).toHaveBeenCalledOnce();
    expect(spies.update).toHaveBeenCalledOnce();
    expect(spies.setStatus).toHaveBeenCalledOnce();
  });

  it("returns the array of per-call results in call order", async () => {
    const { deps, spies } = makeDeps();
    spies.query.mockResolvedValueOnce(["A"]);
    spies.get.mockResolvedValueOnce({ id: "B" });
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [
        { tool: "mcp__store__query", args: { entity: "Briefs", filter: {} } },
        { tool: "mcp__store__get", args: { entity: "Briefs", id: "B" } },
      ],
    };
    const results = await executeWriteStep(step, deps);
    expect(results).toEqual([["A"], { id: "B" }]);
  });

  it("throws UnsupportedToolError for tools not in the dispatch table", async () => {
    const { deps } = makeDeps();
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [{ tool: "mcp__analytics__top_creatives", args: { window_days: 7 } }],
    };
    await expect(executeWriteStep(step, deps)).rejects.toBeInstanceOf(UnsupportedToolError);
  });

  it("returns [] for an idempotent no-op (empty calls)", async () => {
    const { deps } = makeDeps();
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "X2-design",
      calls: [],
    };
    const results = await executeWriteStep(step, deps);
    expect(results).toEqual([]);
  });

  it("throws when a store.create returns { ok: false } — compliance failures surface as halts, not silent skips", async () => {
    // Regression: on run_1779779169 (2026-05-26), P3-persist silently swallowed
    // two store.create compliance failures and let the step report success.
    // The variant-count shortfall only showed up two steps later at P5-confirm,
    // by which point render workers had already burned compute.
    const { deps, spies } = makeDeps();
    spies.create.mockResolvedValueOnce({
      ok: false,
      problems: ["shotlistEn: banned phrase ('guaranteed returns')"],
    });
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T-test",
      calls: [
        {
          tool: "mcp__store__create",
          args: { entity: "Briefs", props: { runId: "r1" } },
        },
      ],
    };
    await expect(executeWriteStep(step, deps)).rejects.toThrow(
      /guaranteed returns/,
    );
  });

  it("does not throw for store.create { ok: true } — the existing happy path is unchanged", async () => {
    const { deps } = makeDeps(); // default mock returns { ok: true }
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T-test",
      calls: [
        {
          tool: "mcp__store__create",
          args: { entity: "Briefs", props: { runId: "r1" } },
        },
      ],
    };
    const results = await executeWriteStep(step, deps);
    expect(results).toHaveLength(1);
  });
});

describe("executeWriteStep — $<label> substitution", () => {
  it("substitutes a labelled prior-call result into a later call arg", async () => {
    const { deps, spies } = makeDeps();
    spies.query.mockResolvedValueOnce([{ ad_id: "a1" }, { ad_id: "a2" }]);
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "A1",
      calls: [
        {
          tool: "mcp__store__query",
          label: "insights",
          args: { entity: "PerformanceReports", filter: {} },
        },
        // a downstream tool (mocked here as a store call) consumes the captured value
        {
          tool: "mcp__store__create",
          args: { entity: "PerformanceReports", props: { rows: "$insights" } },
        },
      ],
    };
    await executeWriteStep(step, deps);
    expect(spies.create).toHaveBeenCalledWith("PerformanceReports", {
      rows: [{ ad_id: "a1" }, { ad_id: "a2" }],
    });
  });

  it("recurses into nested object/array args for substitution", async () => {
    const { deps, spies } = makeDeps();
    spies.get.mockResolvedValueOnce({ id: "captured" });
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [
        { tool: "mcp__store__get", label: "row", args: { entity: "Briefs", id: "b1" } },
        {
          tool: "mcp__store__update",
          args: {
            entity: "Briefs",
            id: "b1",
            props: { nested: { deep: ["$row", "literal"] } },
          },
        },
      ],
    };
    await executeWriteStep(step, deps);
    expect(spies.update).toHaveBeenCalledWith(
      "Briefs",
      "b1",
      { nested: { deep: [{ id: "captured" }, "literal"] } },
      undefined,
    );
  });

  it("walks a single-segment dot-path to unwrap a captured field", async () => {
    const { deps, spies } = makeDeps();
    spies.query.mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }] });
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [
        {
          tool: "mcp__store__query",
          label: "insights",
          args: { entity: "PerformanceReports", filter: {} },
        },
        {
          tool: "mcp__store__create",
          args: { entity: "PerformanceReports", props: { rows: "$insights.rows" } },
        },
      ],
    };
    await executeWriteStep(step, deps);
    expect(spies.create).toHaveBeenCalledWith("PerformanceReports", {
      rows: [{ id: "a" }, { id: "b" }],
    });
  });

  it("walks a multi-segment dot-path", async () => {
    const { deps, spies } = makeDeps();
    spies.get.mockResolvedValueOnce({ data: { items: { count: 42 } } });
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [
        { tool: "mcp__store__get", label: "row", args: { entity: "Briefs", id: "x" } },
        {
          tool: "mcp__store__update",
          args: {
            entity: "Briefs",
            id: "x",
            props: { count: "$row.data.items.count" },
          },
        },
      ],
    };
    await executeWriteStep(step, deps);
    expect(spies.update).toHaveBeenCalledWith(
      "Briefs",
      "x",
      { count: 42 },
      undefined,
    );
  });

  it("throws UnknownSubstitutionLabelError when a dot-path walks off a non-object", async () => {
    const { deps, spies } = makeDeps();
    spies.create.mockResolvedValueOnce({ ok: true, id: "abc" });
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [
        { tool: "mcp__store__create", label: "row", args: { entity: "Briefs", props: {} } },
        {
          tool: "mcp__store__update",
          args: { entity: "Briefs", id: "x", props: { x: "$row.id.deeper" } },
        },
      ],
    };
    await expect(executeWriteStep(step, deps)).rejects.toBeInstanceOf(
      UnknownSubstitutionLabelError,
    );
  });

  it("throws UnknownSubstitutionLabelError when the label was never captured", async () => {
    const { deps } = makeDeps();
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [
        { tool: "mcp__store__create", args: { entity: "Briefs", props: { rows: "$nope" } } },
      ],
    };
    await expect(executeWriteStep(step, deps)).rejects.toBeInstanceOf(
      UnknownSubstitutionLabelError,
    );
  });

  it("leaves literal-looking strings that don't match the $<label> pattern alone", async () => {
    const { deps, spies } = makeDeps();
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T",
      calls: [
        // "$10 off" is content, not a substitution reference — must pass through
        { tool: "mcp__store__create", args: { entity: "Briefs", props: { title: "$10 off" } } },
      ],
    };
    await executeWriteStep(step, deps);
    expect(spies.create).toHaveBeenCalledWith("Briefs", { title: "$10 off" });
  });

  it("preserves Date instances inside nested props (does not flatten to {})", async () => {
    // Regression: substitute() used to recurse into Date via Object.entries (→ []),
    // returning {} and crashing Drizzle's PgTimestamp.mapToDriverValue codec.
    const { deps, spies } = makeDeps();
    const when = new Date("2026-05-28T11:00:00.000Z");
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T-date",
      calls: [
        {
          tool: "mcp__store__update",
          args: {
            entity: "CreativeVariants",
            id: "v1",
            props: { organicScheduledFor: when },
          },
        },
      ],
    };
    await executeWriteStep(step, deps);
    const [, , props] = spies.update.mock.calls[0]!;
    expect(props.organicScheduledFor).toBeInstanceOf(Date);
    expect((props.organicScheduledFor as Date).toISOString()).toBe(when.toISOString());
  });
});

describe("executeCheck", () => {
  it("dispatches a single read call and returns the bare result", async () => {
    const { deps, spies } = makeDeps();
    spies.query.mockResolvedValueOnce([{ id: "found" }]);
    const result = await executeCheck(
      { tool: "mcp__store__query", args: { entity: "Briefs", filter: { runId: "r1" } } },
      deps,
    );
    expect(result).toEqual([{ id: "found" }]);
    expect(spies.query).toHaveBeenCalledOnce();
  });

  it("propagates UnsupportedToolError for tools missing from the table", async () => {
    const { deps } = makeDeps();
    await expect(
      executeCheck({ tool: "mcp__analytics__top_creatives", args: {} }, deps),
    ).rejects.toBeInstanceOf(UnsupportedToolError);
  });
});
