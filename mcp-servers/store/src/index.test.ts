import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closeDb } from "@engineerdad/store";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { handlers } from "./index.js";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

describe("mcp-store handlers", () => {
  it("query returns array on a valid entity", async () => {
    const r = await handlers.query({ entity: "Briefs", filter: {} });
    expect(Array.isArray(r)).toBe(true);
  });

  it("query rejects an unknown entity", async () => {
    await expect(
      handlers.query({ entity: "Wat" as never, filter: {} }),
    ).rejects.toThrow(/entity/i);
  });

  it("get returns undefined for an unknown id", async () => {
    const r = await handlers.get({
      entity: "Briefs",
      id: "00000000-0000-0000-0000-000000000000",
    });
    expect(r).toBeUndefined();
  });

  it("create returns { ok:true, id } on success", async () => {
    const r = await handlers.create({
      entity: "Briefs",
      props: {
        title: "T",
        runId: "r-test-create",
        createdBy: "Human",
        angle: "epf-shortfall-parent-worry",
      },
    });
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("update returns { ok:true } on a known id", async () => {
    const c = await handlers.create({
      entity: "Briefs",
      props: {
        title: "T",
        runId: "r-update",
        createdBy: "Human",
        angle: "epf-shortfall-parent-worry",
      },
    });
    const r = await handlers.update({
      entity: "Briefs",
      id: c.id!,
      props: { promise: "X" },
    });
    expect(r.ok).toBe(true);
  });

  it("set_status flips the row", async () => {
    const c = await handlers.create({
      entity: "Briefs",
      props: {
        title: "T",
        runId: "r-status",
        createdBy: "Human",
        angle: "epf-shortfall-parent-worry",
      },
    });
    const r = await handlers.set_status({
      entity: "Briefs",
      id: c.id!,
      status: "Approved",
    });
    expect(r.ok).toBe(true);
  });
});
