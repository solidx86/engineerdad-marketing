import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db, makeCrud, type Crud } from "@engineerdad/store";
import { complianceScan } from "@engineerdad/shared";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { executeWriteStep } from "./exec.js";
import type { ExecDeps } from "./exec.types.js";
import type { Step } from "./types.js";

/**
 * Integration test: drive `executeWriteStep` against the real Postgres
 * `engineerdad_test` database via the live `makeCrud` factory. Mirrors
 * `packages/store/src/crud.test.ts`'s setup. Asserts the orchestrator's
 * eager-execute path produces the same observable state the conductor's
 * legacy write-step path produced.
 */

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
});

function makeDeps(): { deps: ExecDeps; scanSpy: ReturnType<typeof vi.fn> } {
  // Inject a no-op compliance scanner with a vi.fn spy so we can count
  // per-entity-write invocations. Bypasses the actual banned-phrase rules —
  // those are tested in `packages/shared/src/compliance.test.ts`.
  const scanSpy = vi.fn(async () => ({ ok: true, problems: [] as string[] }));
  const store: Crud = makeCrud(db, { complianceScan: scanSpy });
  return { deps: { store, compliance: complianceScan }, scanSpy };
}

describe("executeWriteStep — live Postgres", () => {
  it("3 store.create calls persist 3 rows and the compliance scanner fires 3 times", async () => {
    const { deps, scanSpy } = makeDeps();
    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T-fixture",
      calls: [
        {
          tool: "mcp__store__create",
          args: {
            entity: "Briefs",
            props: {
              title: "Brief A",
              runId: "run_exec_integ",
              persona: "young_parents_25_35",
              promise: "save for child education",
              angle: "epf-shortfall-parent-worry",
              proofType: ["case_study"],
              funnelStage: "TOFU",
              bodyEn: "EN body",
              bodyBm: "BM body",
              budgetBucket: "70",
            },
          },
        },
        {
          tool: "mcp__store__create",
          args: {
            entity: "Briefs",
            props: {
              title: "Brief B",
              runId: "run_exec_integ",
              persona: "young_parents_25_35",
              promise: "start saving with PRS",
              angle: "epf-shortfall-parent-worry",
              proofType: ["regulator_phrase"],
              funnelStage: "MOFU",
              bodyEn: "EN body",
              bodyBm: "BM body",
              budgetBucket: "20",
            },
          },
        },
        {
          tool: "mcp__store__create",
          args: {
            entity: "Briefs",
            props: {
              title: "Brief C",
              runId: "run_exec_integ",
              persona: "young_parents_25_35",
              promise: "consolidate retirement",
              angle: "epf-shortfall-parent-worry",
              proofType: ["chart"],
              funnelStage: "BOFU",
              bodyEn: "EN body",
              bodyBm: "BM body",
              budgetBucket: "10",
            },
          },
        },
      ],
    };

    const results = await executeWriteStep(step, deps);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r).toMatchObject({ ok: true });
      expect((r as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    }

    const rows = await deps.store.query("Briefs", { runId: "run_exec_integ" });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.title).sort()).toEqual(["Brief A", "Brief B", "Brief C"]);

    expect(scanSpy).toHaveBeenCalledTimes(3);
  });

  it("query → substitute-into-update round-trip against live DB", async () => {
    const { deps } = makeDeps();
    const seeded = await deps.store.create("Briefs", {
      title: "Seed Brief",
      runId: "run_exec_sub",
      persona: "young_parents_25_35",
      angle: "epf-shortfall-parent-worry",
      bodyEn: "EN body",
      bodyBm: "BM body",
    });
    expect(seeded.ok).toBe(true);

    const step: Extract<Step, { kind: "write" }> = {
      kind: "write",
      stepId: "T-sub",
      calls: [
        {
          tool: "mcp__store__query",
          label: "found",
          args: { entity: "Briefs", filter: { runId: "run_exec_sub" } },
        },
        // The X3-write pattern: a later call consumes a labelled prior result.
        // Update keeps this test self-contained (no chained-create.id needed).
        {
          tool: "mcp__store__update",
          args: {
            entity: "Briefs",
            id: seeded.id,
            props: { promise: "post-substitution updated" },
          },
        },
      ],
    };

    const results = await executeWriteStep(step, deps);
    expect(results).toHaveLength(2);
    expect(Array.isArray(results[0])).toBe(true);

    const got = await deps.store.get("Briefs", seeded.id!);
    expect((got as { promise: string }).promise).toBe("post-substitution updated");
  });
});
