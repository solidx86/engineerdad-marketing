import { describe, it, expect } from "vitest";
import { buildIndex, search } from "./bm25.js";
import { tokenize } from "./tokenize.js";

describe("BM25", () => {
  it("ranks the doc that contains the rare query term highest", () => {
    const docs = [
      { chunk_id: "a", tokens: tokenize("Past performance is not a guarantee of future performance.", "en") },
      { chunk_id: "b", tokens: tokenize("EngineerDad rebalances the portfolio every six months.", "en") },
      { chunk_id: "c", tokens: tokenize("Public Mutual unit trusts and PRS are the only permissible products.", "en") },
    ];
    const idx = buildIndex(docs);
    const hits = search(idx, "rebalances portfolio", "en", 3);
    expect(hits[0]?.chunk_id).toBe("b");
  });
  it("returns empty for empty index", () => {
    const idx = buildIndex([]);
    expect(search(idx, "anything", "en", 3)).toEqual([]);
  });
  it("filter excludes ids", () => {
    const docs = [
      { chunk_id: "a", tokens: tokenize("disclaimer past performance", "en") },
      { chunk_id: "b", tokens: tokenize("disclaimer past performance", "en") },
    ];
    const idx = buildIndex(docs);
    const hits = search(idx, "disclaimer", "en", 5, (id) => id === "a");
    expect(hits.map((h) => h.chunk_id)).toEqual(["a"]);
  });
});
