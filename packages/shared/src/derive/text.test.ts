import { describe, it, expect } from "vitest";
import {
  slugify,
  truncateAtWord,
  readingTime,
  topicTag,
  extractKeywords,
} from "./text.js";

describe("slugify", () => {
  it("kebab-cases a plain title", () => {
    expect(slugify("Public Mutual vs PRS")).toBe("public-mutual-vs-prs");
  });
  it("strips punctuation and collapses separators", () => {
    expect(slugify("  Hello, World! -- Again  ")).toBe("hello-world-again");
  });
  it("returns an empty string for punctuation-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("truncateAtWord", () => {
  it("returns text unchanged when within the limit", () => {
    expect(truncateAtWord("short text", 50)).toBe("short text");
  });
  it("cuts at the last word boundary within the limit", () => {
    expect(truncateAtWord("the quick brown fox jumps", 16)).toBe("the quick brown");
  });
  it("hard-cuts when no space precedes the limit", () => {
    expect(truncateAtWord("supercalifragilistic", 10)).toBe("supercalif");
  });
});

describe("readingTime", () => {
  it("rounds up to whole minutes at 250 wpm", () => {
    expect(readingTime("word ".repeat(600))).toBe("3 min read");
  });
  it("never returns less than 1 minute", () => {
    expect(readingTime("just a few words")).toBe("1 min read");
  });
  it("treats empty input as 1 minute", () => {
    expect(readingTime("")).toBe("1 min read");
  });
});

describe("topicTag", () => {
  it("uppercases and drops question words and fillers", () => {
    expect(topicTag("Why PRS Matters for Retirement")).toBe("PRS MATTERS RETIREMENT");
  });
  it("strips punctuation", () => {
    expect(topicTag("The Compound-Interest Effect")).toBe("COMPOUND INTEREST EFFECT");
  });
  it("caps the result at 60 characters", () => {
    const long =
      "education fund planning strategy guide malaysia parents savings horizon outlook";
    expect(topicTag(long).length).toBeLessThanOrEqual(60);
  });
});

describe("extractKeywords", () => {
  it("pulls deduped keywords from query and topic, dropping stopwords", () => {
    expect(
      extractKeywords("best PRS fund for child education", "PRS Education Planning"),
    ).toEqual(["best", "prs", "fund", "child", "education", "planning"]);
  });
  it("caps the list at 10 keywords", () => {
    const q = "one two three four five six seven eight nine ten eleven twelve";
    expect(extractKeywords(q, "").length).toBe(10);
  });
});
