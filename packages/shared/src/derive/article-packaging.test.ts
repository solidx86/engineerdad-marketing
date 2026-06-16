import { describe, it, expect } from "vitest";
import { deriveArticlePackaging } from "./article-packaging.js";

describe("deriveArticlePackaging", () => {
  it("derives packaging from article substance", () => {
    const p = deriveArticlePackaging({
      titleEn: "How to Start a DCA Education Fund",
      topic: "How to set up a children education fund in Malaysia",
      targetQuery: "children education fund malaysia",
      bodyEn:
        "**Saving** for your child's _future_ is hard. See [our guide](https://x.my) " +
        "for the full plan. " +
        "word ".repeat(300),
    });
    expect(p.slug).toBe("how-to-start-a-dca-education-fund");
    expect(p.readingTime).toMatch(/^\d+ min read$/);
    expect(p.keywords.length).toBeLessThanOrEqual(10);
    expect(p.topicTag.length).toBeLessThanOrEqual(60);
    expect(p.description.length).toBeLessThanOrEqual(200);
    expect(p.description).not.toMatch(/[*_#]/); // markdown stripped
    expect(p.ogImageUrl).toContain("engineerdad");
  });

  it("falls back to the Topic for the slug when Title is empty", () => {
    const p = deriveArticlePackaging({
      titleEn: "",
      topic: "Unit Trust Basics",
      targetQuery: "q",
      bodyEn: "body",
    });
    expect(p.slug).toBe("unit-trust-basics");
  });
});
