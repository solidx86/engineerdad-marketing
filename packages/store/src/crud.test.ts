import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "./db.js";
import { makeCrud } from "./crud.js";
import { scanProps } from "./compliance.js";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
});

describe("crud — Briefs round-trip", () => {
  it("create → query → get → update → setStatus", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });

    const created = await crud.create("Briefs", {
      title: "Test Brief",
      runId: "run_test",
      createdBy: "Human",
      persona: "young_parents_25_35",
      angle: "epf-shortfall-parent-worry",
      approvalStatus: "Awaiting Approval",
    });
    expect(created.ok).toBe(true);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await crud.query("Briefs", { runId: "run_test" });
    expect(list).toEqual([{ id: created.id, title: "Test Brief" }]);

    const got = await crud.get("Briefs", created.id!);
    expect(got?.persona).toBe("young_parents_25_35");

    const updated = await crud.update("Briefs", created.id!, { promise: "Edited" });
    expect(updated.ok).toBe(true);
    const refetched = await crud.get("Briefs", created.id!);
    expect(refetched?.promise).toBe("Edited");

    await crud.setStatus("Briefs", created.id!, "Approved");
    const approved = await crud.query("Briefs", { runId: "run_test", approvalStatus: "Approved" });
    expect(approved).toHaveLength(1);
  });

  it("query never returns bulk text fields by default", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    await crud.create("Briefs", {
      title: "T",
      runId: "r",
      createdBy: "Human",
      angle: "epf-shortfall-parent-worry",
      bodyEn: "X".repeat(5000),
      bodyBm: "Y".repeat(5000),
    });
    const list = await crud.query("Briefs", { runId: "r" });
    expect(list[0]).not.toHaveProperty("bodyEn");
    expect(list[0]).not.toHaveProperty("bodyBm");
    expect(list[0]).toEqual({ id: expect.any(String), title: "T" });
  });

  it("query accepts opt-in fields", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    await crud.create("Briefs", {
      title: "T",
      runId: "r",
      createdBy: "Human",
      angle: "epf-shortfall-parent-worry",
      persona: "young_parents_25_35",
    });
    const list = await crud.query("Briefs", { runId: "r" }, { fields: ["persona"] });
    expect(list[0]?.persona).toBe("young_parents_25_35");
  });

  it("update preserves fill-only-if-empty semantics when called with fillOnlyIfEmpty: true", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    const { id } = await crud.create("Briefs", {
      title: "T",
      runId: "r",
      createdBy: "Human",
      angle: "epf-shortfall-parent-worry",
      promise: "ORIGINAL",
    });
    await crud.update("Briefs", id!, { promise: "NEW" }, { fillOnlyIfEmpty: true });
    expect((await crud.get("Briefs", id!))?.promise).toBe("ORIGINAL");
    await crud.update("Briefs", id!, { persona: "young_parents_25_35" }, { fillOnlyIfEmpty: true });
    expect((await crud.get("Briefs", id!))?.persona).toBe("young_parents_25_35");
  });

  it("create refuses on compliance failure", async () => {
    const crud = makeCrud(db, {
      complianceScan: async () => ({ ok: false, problems: ["banned phrase: guaranteed returns"] }),
    });
    const r = await crud.create("Briefs", { title: "T", runId: "r", createdBy: "Human" });
    expect(r.ok).toBe(false);
    expect(r.problems?.[0]).toContain("guaranteed returns");
  });
});

describe("crud — Distributions append-only event log", () => {
  const TARGET_ID = "33333333-3333-3333-3333-333333333333";

  it("round-trips and returns expected fields on query", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    const now = new Date();
    const { ok, id } = await crud.create("Distributions", {
      title: "route CreativeVariants/foo → Meta-paid",
      runId: "run_dist",
      createdBy: "XOS",
      approvalStatus: "Logged",
      complianceCheck: true,
      targetEntity: "CreativeVariants",
      targetId: TARGET_ID,
      channel: "Meta-paid",
      status: "routed",
      tool: "mcp__meta-ads__create_ad",
      attemptedAt: now,
      completedAt: now,
      outputJson: { adId: "ad_123" },
      attempt: 1,
      dryRun: false,
      authorStep: "D2b-route",
    });
    expect(ok).toBe(true);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await crud.query(
      "Distributions",
      { runId: "run_dist" },
      { fields: ["channel", "status", "targetEntity", "targetId", "authorStep"] },
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id,
      title: "route CreativeVariants/foo → Meta-paid",
      channel: "Meta-paid",
      status: "routed",
      targetEntity: "CreativeVariants",
      targetId: TARGET_ID,
      authorStep: "D2b-route",
    });
  });

  it("is append-only: two writes against same (runId,targetId,channel) yield two distinct rows", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    const baseProps = {
      runId: "run_dist",
      createdBy: "XOS" as const,
      approvalStatus: "Logged",
      complianceCheck: true,
      targetEntity: "CreativeVariants",
      targetId: TARGET_ID,
      channel: "YouTube",
      authorStep: "D2b-route",
    };
    const a = await crud.create("Distributions", {
      ...baseProps,
      title: "attempt 1",
      status: "failed",
      attempt: 1,
      errorMessage: "transient 500",
    });
    const b = await crud.create("Distributions", {
      ...baseProps,
      title: "attempt 2",
      status: "routed",
      attempt: 2,
      tool: "mcp__youtube__upload_video",
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.id).not.toBe(b.id);

    const list = await crud.query(
      "Distributions",
      { runId: "run_dist" },
      { fields: ["channel", "status", "attempt"] },
    );
    expect(list).toHaveLength(2);
    const attempts = list.map((r) => r.attempt).sort();
    expect(attempts).toEqual([1, 2]);
    const statuses = list.map((r) => r.status).sort();
    expect(statuses).toEqual(["failed", "routed"]);
  });

  it("compliance exemption: banned phrases in errorMessage do not block insert", async () => {
    // Use the REAL scanProps to demonstrate the exemption end-to-end —
    // not the no-op mock used by the other tests.
    const crud = makeCrud(db, { complianceScan: scanProps });

    const banned = await crud.create("Distributions", {
      title: "route failed: guaranteed returns wording tripped scanner",
      runId: "run_dist_exempt",
      createdBy: "XOS",
      approvalStatus: "Logged",
      complianceCheck: true,
      targetEntity: "CreativeVariants",
      targetId: TARGET_ID,
      channel: "Meta-paid",
      status: "failed",
      attempt: 1,
      dryRun: false,
      authorStep: "D2b-route",
      errorMessage: "guaranteed returns: banned phrase",
    });
    expect(banned.ok).toBe(true);
    expect(banned.id).toMatch(/^[0-9a-f-]{36}$/);

    // Sanity check: the same banned phrase WOULD block a Briefs insert.
    const blocked = await crud.create("Briefs", {
      title: "guaranteed returns",
      runId: "run_dist_exempt",
      createdBy: "Human",
    });
    expect(blocked.ok).toBe(false);
  });
});

// ── Reel render lifecycle fields (per 2026-05-28-heygen-reel-pipeline) ──
//   Migration 0002 added render_state + render_started_at to creative_variants
//   and dropped reel_mp4_url. These tests verify the columns round-trip and
//   stay null for static formats (the backward-compat invariant the spec
//   promises).
describe("crud — CreativeVariants render lifecycle fields", () => {
  it("static-format variant (Feed) round-trips with all render fields null", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    const { ok, id } = await crud.create("CreativeVariants", {
      title: "Feed variant — no render state",
      runId: "run_static",
      createdBy: "MediaProd",
      script: "script_static",
      format: "Feed",
      aspect: "4:5",
    });
    expect(ok).toBe(true);

    const got = await crud.get("CreativeVariants", id!);
    expect(got?.reelHeygenJobId).toBeNull();
    expect(got?.renderState).toBeNull();
    expect(got?.renderStartedAt).toBeNull();
  });

  it("Reel variant transitions through render states (orphan-recovery contract)", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    const { ok, id } = await crud.create("CreativeVariants", {
      title: "Reel variant — orphan-recovery contract",
      runId: "run_reel",
      createdBy: "MediaProd",
      script: "script_reel",
      format: "Reel",
      aspect: "9:16",
    });
    expect(ok).toBe(true);

    // Step 3a: worker persists heygenJobId + state BEFORE polling.
    const startedAt = new Date();
    const set1 = await crud.update("CreativeVariants", id!, {
      reelHeygenJobId: "heygen_job_abc123",
      renderState: "HeygenGenerating",
      renderStartedAt: startedAt,
    });
    expect(set1.ok).toBe(true);

    const mid = await crud.get("CreativeVariants", id!);
    expect(mid?.reelHeygenJobId).toBe("heygen_job_abc123");
    expect(mid?.renderState).toBe("HeygenGenerating");
    expect(mid?.renderStartedAt).toBeTruthy();

    // Terminal state: stitch + upload completed.
    const set2 = await crud.update("CreativeVariants", id!, {
      renderState: "Uploaded",
    });
    expect(set2.ok).toBe(true);
    const done = await crud.get("CreativeVariants", id!);
    expect(done?.renderState).toBe("Uploaded");
    expect(done?.reelHeygenJobId).toBe("heygen_job_abc123");  // preserved
  });

  it("Reel variant can land in RenderFailed terminal state", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    const { id } = await crud.create("CreativeVariants", {
      title: "Reel variant — failed render",
      runId: "run_reel_fail",
      createdBy: "MediaProd",
      format: "Reel",
      aspect: "9:16",
    });

    await crud.update("CreativeVariants", id!, {
      reelHeygenJobId: "heygen_job_xyz",
      renderState: "RenderFailed",
    });

    const failed = await crud.get("CreativeVariants", id!);
    expect(failed?.renderState).toBe("RenderFailed");
    expect(failed?.reelHeygenJobId).toBe("heygen_job_xyz");
  });
});
