import { describe, it, expect } from "vitest";
import { verifyDistribute } from "./verify-distribute.js";
import type { DistVariant, DistArticle } from "../distribute/plan-distribution.js";

function v(over: Partial<DistVariant> = {}): DistVariant {
  return {
    rowId: "row1",
    variantId: "v1",
    format: "Reel",
    aspect: "9:16",
    channels: ["Meta-paid"],
    assetFiles: [],
    adId: null,
    ytVideoId: null,
    metaSpec: null,
    ytSpec: null,
    cellId: "c1",
    ...over,
  };
}

function a(over: Partial<DistArticle> = {}): DistArticle {
  return {
    rowId: "art1",
    slug: "s",
    bodyEn: "b",
    bodyMs: "b",
    faqEn: "f",
    faqMs: "f",
    deliveredAt: null,
    ...over,
  };
}

describe("verifyDistribute", () => {
  it("passes when every expected row is satisfied in actual", () => {
    const expected = [v({ channels: ["Meta-paid"] })];
    const actual = [v({ channels: ["Meta-paid"], adId: { en: "ad_en", ms: "ad_ms" } })];
    expect(verifyDistribute(expected, [], actual, [])).toEqual({ ok: true, problems: [] });
  });

  it("fails a Meta-paid variant with no Ad ID in actual", () => {
    const expected = [v({ channels: ["Meta-paid"] })];
    const r = verifyDistribute(expected, [], expected, []);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/Meta-paid/);
  });

  it("fails a YouTube variant with no YT Video ID", () => {
    const expected = [v({ channels: ["YouTube"] })];
    const r = verifyDistribute(expected, [], expected, []);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/YouTube/);
  });

  it("fails an article with no Delivered At", () => {
    const expected = [a()];
    expect(verifyDistribute([], expected, [], expected).ok).toBe(false);
  });

  it("passes a partially-distributed Meta variant (one language)", () => {
    const expected = [v({ channels: ["Meta-paid"] })];
    const actual = [v({ channels: ["Meta-paid"], adId: { en: "ad_en", ms: null } })];
    expect(verifyDistribute(expected, [], actual, []).ok).toBe(true);
  });

  it("passes an already-satisfied row (idempotent)", () => {
    const done = v({ channels: ["Meta-paid"], adId: { en: "x", ms: "y" } });
    expect(verifyDistribute([done], [], [done], []).ok).toBe(true);
  });

  it("passes a delivered article", () => {
    const done = a({ deliveredAt: "2026-05-22" });
    expect(verifyDistribute([], [done], [], [done]).ok).toBe(true);
  });
});
