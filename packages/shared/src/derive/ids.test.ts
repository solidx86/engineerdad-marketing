import { describe, it, expect } from "vitest";
import { variantId } from "./ids.js";

describe("variantId", () => {
  it("returns a 12-char lowercase hex string", () => {
    expect(variantId("script_abc", "Reel", "9:16")).toMatch(/^[0-9a-f]{12}$/);
  });
  it("is deterministic for the same inputs", () => {
    expect(variantId("script_abc", "Feed", "4:5")).toBe(
      variantId("script_abc", "Feed", "4:5"),
    );
  });
  it("differs when the aspect differs", () => {
    expect(variantId("script_abc", "Carousel", "4:5")).not.toBe(
      variantId("script_abc", "Carousel", "1:1"),
    );
  });
});
