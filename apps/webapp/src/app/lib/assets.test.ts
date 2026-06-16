import { describe, it, expect } from "vitest";
import { resolveAssetUrl } from "./assets.js";

describe("resolveAssetUrl()", () => {
  it("rewrites file:// URLs to /api/asset", () => {
    const url = "file:///repo/data/assets/run_123/var_abc/0.png";
    expect(resolveAssetUrl(url)).toBe("/api/asset/run_123/var_abc/0.png");
  });
  it("passes https URLs through unchanged", () => {
    const url = "https://cdn.example.com/assets/run_123/var_abc/0.png";
    expect(resolveAssetUrl(url)).toBe(url);
  });
  it("returns the input unchanged when file:// path doesn't match canonical shape", () => {
    const url = "file:///tmp/random.png";
    expect(resolveAssetUrl(url)).toBe(url);
  });
  it("handles missing extension safely", () => {
    expect(resolveAssetUrl("file:///x/data/assets/r/v/s")).toBe("/api/asset/r/v/s");
  });
});
