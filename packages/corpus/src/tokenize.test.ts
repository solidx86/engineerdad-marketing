import { describe, it, expect } from "vitest";
import { detectLang, tokenize } from "./tokenize.js";

describe("detectLang", () => {
  it("detects English", () => {
    expect(detectLang("Investment involves risk. Past performance is not future performance.")).toBe("en");
  });
  it("detects Bahasa Malaysia", () => {
    expect(detectLang("Pelaburan melibatkan risiko. Prestasi lalu bukan petunjuk prestasi masa depan.")).toBe("ms");
  });
});

describe("tokenize", () => {
  it("EN: lowercase, drops stopwords, splits on whitespace", () => {
    const t = tokenize("The fund returns are educational only.", "en");
    expect(t).toContain("fund");
    expect(t).toContain("returns");
    expect(t).toContain("educational");
    expect(t).not.toContain("the");
    expect(t).not.toContain("are");
  });
});
