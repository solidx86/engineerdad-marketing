import { describe, it, expect } from "vitest";
import { creativeVariants } from "./schema.js";
import { validateProps } from "./validate-props.js";

describe("validateProps", () => {
  it("rejects unknown columns (the B-037 phantom keys)", () => {
    const problems = validateProps(creativeVariants, {
      assetFiles: [{ url: "https://x/y.mp4", sha256: "abc" }],
      durationSeconds: 28.7,
      subtitleUrl: "https://x/y.vtt",
    });
    expect(problems).toContain('unknown column "durationSeconds"');
    expect(problems).toContain('unknown column "subtitleUrl"');
  });

  it("accepts real columns", () => {
    expect(
      validateProps(creativeVariants, { assetFiles: [], renderState: "Uploaded" }),
    ).toEqual([]);
  });

  it("rejects a string written to a timestamp column", () => {
    const problems = validateProps(creativeVariants, {
      renderStartedAt: "2026-06-17T00:00:00Z",
    });
    expect(problems).toContain('column "renderStartedAt" expects a Date, got string');
  });
});
