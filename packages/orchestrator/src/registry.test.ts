import { describe, it, expect } from "vitest";
import { LIVE_REGISTRY, FIXTURE_REGISTRY } from "./registry.js";

describe("LIVE_REGISTRY", () => {
  it("is the ordered design-§8 loop of 9 stages", () => {
    expect(LIVE_REGISTRY.map((s) => s.id)).toEqual([
      "tracking",
      "analytics",
      "synthesize",
      "brief",
      "content",
      "produce",
      "schedule",
      "experiment",
      "distribute",
    ]);
  });

  it("has a distinct id per stage", () => {
    const ids = LIVE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders schedule before experiment and distribute", () => {
    const ids = LIVE_REGISTRY.map((s) => s.id);
    expect(ids.indexOf("schedule")).toBeLessThan(ids.indexOf("experiment"));
    expect(ids.indexOf("schedule")).toBeLessThan(ids.indexOf("distribute"));
  });

  it("keeps FIXTURE_REGISTRY available for engine unit tests", () => {
    expect(FIXTURE_REGISTRY.map((s) => s.id)).toEqual(["fixture"]);
  });
});
