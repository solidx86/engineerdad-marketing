import { describe, it, expect } from "vitest";
import { verifyBrief } from "./verify-brief.js";

describe("verifyBrief", () => {
  it("passes a result carrying a non-empty angles[]", () => {
    expect(verifyBrief({ angles: ["angle-1"] })).toEqual({ ok: true, problems: [] });
  });

  it("passes a single angle — cold-start tolerant", () => {
    expect(verifyBrief({ angles: [{ persona: "p" }] }).ok).toBe(true);
  });

  it("fails a null / non-object result", () => {
    expect(verifyBrief(null).ok).toBe(false);
    expect(verifyBrief(42).ok).toBe(false);
  });

  it("fails a result with no angles", () => {
    expect(verifyBrief({}).ok).toBe(false);
    expect(verifyBrief({ angles: [] }).ok).toBe(false);
  });
});

describe("verifyBrief angle-taxonomy assertion", () => {
  it("passes when every angle is in recommendedAngles", () => {
    const r = verifyBrief({ angles: ["a", "b"] }, ["a", "b", "c"]);
    expect(r.ok).toBe(true);
  });

  it("fails when any angle is off-taxonomy, listing all offenders", () => {
    const r = verifyBrief({ angles: ["a", "x", "y", "b"] }, ["a", "b"]);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes('"x"'))).toBe(true);
    expect(r.problems.some((p) => p.includes('"y"'))).toBe(true);
    // Don't assert exact problems.length — implementation may produce 2 or 2+overall messages.
  });

  it("skips assertion when recommendedAngles absent (cold-start path)", () => {
    const r = verifyBrief({ angles: ["whatever"] }, undefined);
    expect(r.ok).toBe(true);
  });

  it("skips assertion when recommendedAngles empty", () => {
    const r = verifyBrief({ angles: ["whatever"] }, []);
    expect(r.ok).toBe(true);
  });

  it("tolerates object-shaped angles (not just strings)", () => {
    // brief-writer may return [{ angle: "a" }, { angle: "b" }] depending on JSON shape.
    const r = verifyBrief({ angles: [{ angle: "a" }, { angle: "b" }] }, ["a", "b"]);
    expect(r.ok).toBe(true);
  });

  it("fails with 'not a string' diagnostic when angle field missing under taxonomy mode", () => {
    const r = verifyBrief({ angles: [{ persona: "p" }] }, ["a", "b"]);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes("not a string"))).toBe(true);
  });
});
