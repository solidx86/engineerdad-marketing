import { describe, it, expect } from "vitest";
import { scanProps } from "./compliance.js";

describe("scanProps", () => {
  it("passes a clean Brief", async () => {
    const r = await scanProps("Briefs", {
      title: "Education Fund Math",
      bodyEn: "PRS gives RM3,000 tax relief.",
      bodyBm: "PRS memberi pelepasan cukai RM3,000.",
    });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("flags a banned phrase in bodyEn", async () => {
    const r = await scanProps("Briefs", {
      title: "T",
      bodyEn: "Guaranteed returns of 10% per year.",
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ").toLowerCase()).toContain("guaranteed");
  });

  it("ignores non-string fields", async () => {
    const r = await scanProps("Scripts", {
      title: "T",
      durationSec: 60,
      proofRefs: ["a.md"],
    });
    expect(r.ok).toBe(true);
  });
});
