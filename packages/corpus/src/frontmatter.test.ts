// packages/corpus/src/frontmatter.test.ts
import { describe, expect, it } from "vitest";
import { parseFrontmatter, stripFrontmatter, type CorpusFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns empty object when no frontmatter present", () => {
    const out = parseFrontmatter("# heading\n\nbody");
    expect(out).toEqual({});
  });

  it("parses scalar fields", () => {
    const md = `---
cluster: mechanics
granularity: concept
source_type: public
source_ref: PMB Master Prospectus 2025 p.42
verified_at: 2026-05-29
lang_status: en_only
---

body`;
    const out: CorpusFrontmatter = parseFrontmatter(md);
    expect(out.cluster).toBe("mechanics");
    expect(out.granularity).toBe("concept");
    expect(out.source_type).toBe("public");
    expect(out.source_ref).toBe("PMB Master Prospectus 2025 p.42");
    expect(out.verified_at).toBe("2026-05-29");
    expect(out.lang_status).toBe("en_only");
  });

  it("parses related as a list", () => {
    const md = `---
related: [a-switching, a-fee-schedule]
---

body`;
    const out = parseFrontmatter(md);
    expect(out.related).toEqual(["a-switching", "a-fee-schedule"]);
  });

  it("ignores unknown fields", () => {
    const md = `---
unknown_field: xxx
cluster: tax
---

body`;
    const out = parseFrontmatter(md);
    expect(out.cluster).toBe("tax");
    expect((out as Record<string, unknown>).unknown_field).toBeUndefined();
  });

  it("strips frontmatter from body", () => {
    const md = `---
cluster: portfolio
---

body line one
body line two`;
    expect(stripFrontmatter(md)).toBe("body line one\nbody line two");
  });

  it("leaves body untouched when no frontmatter", () => {
    expect(stripFrontmatter("# h\nbody")).toBe("# h\nbody");
  });
});

describe("objection cluster + funnel_tier", () => {
  it("parses cluster: objection and funnel_tier", () => {
    const raw = `---\ncluster: objection\nfunnel_tier: necessity\ngranularity: concept\nsource_type: public\n---\nbody`;
    const fm = parseFrontmatter(raw);
    expect(fm.cluster).toBe("objection");
    expect(fm.funnel_tier).toBe("necessity");
  });
  it("rejects an invalid funnel_tier", () => {
    const raw = `---\nfunnel_tier: bogus\n---\nbody`;
    expect(parseFrontmatter(raw).funnel_tier).toBeUndefined();
  });
});
