import { describe, expect, it } from "vitest";
import { isIgPublishDisabled, IG_DISABLED_MSG } from "../ig-guard.js";

describe("ig-guard (B-005)", () => {
  it("disables the ig platform", () => {
    expect(isIgPublishDisabled("ig")).toBe(true);
  });

  it("leaves the fb platform enabled", () => {
    expect(isIgPublishDisabled("fb")).toBe(false);
  });

  it("error message carries the ig_publish_disabled code", () => {
    expect(IG_DISABLED_MSG).toMatch(/^ig_publish_disabled:/);
  });

  it("error message points to the manual posting aid", () => {
    expect(IG_DISABLED_MSG).toContain("/posting-pack/organic/");
  });
});
