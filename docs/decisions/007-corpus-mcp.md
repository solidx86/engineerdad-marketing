# 007 — Corpus MCP

Status: Accepted
Date: 2026-05-06
Source: TASKS.md Phase 3d "Decisions locked"
Updated: 2026-05-08 (CJK/ZH branch removed — see ADR-010)

## Context

The corpus MCP is the OS's grounding layer — agents call `search` and `get_compliance_block` to retrieve compliance rules, course materials, and proof references at generation time. Two design choices dominated: PDF extraction (which library) and text retrieval (which algorithm). Both had to work offline, with zero network dependency, on a small-but-multilingual corpus.

## Decision

- **PDF extractor — `unpdf` instead of `pdf-parse`**: pure-JS, ESM-native, no startup-bug hack. Pulls in `canvas` as an optional dep that fails to compile (Xcode CLT issue) but `extractText` doesn't require it; only needed for image rasterisation. Confirmed working from corpus pkg.
- **In-house BM25** (no external lib): tiny postings + IDF over `Record<term, [chunk_id, tf][]>`; k1=1.5, b=0.75. Chosen because corpora are small (target: thousands of chunks max), zero deps, and the math is fully transparent. `search()` accepts an optional `filter(chunkId)` predicate so scope/lang filtering happens at the BM25 layer rather than after.
- **Bilingual tokenisation**: whitespace + stopword filter for EN/BM. Lang detected per chunk: explicit `## English` / `## Bahasa Malaysia` h2 headers in source files take precedence; auto-detection (common BM stopword presence → ms; else en) is the fallback. *(Char-level CJK tokenisation removed in the bilingual migration — see ADR-010.)*
- **Lang-section header convention**: corpus authors structure `corpus/compliance/*.md` with `## English` / `## Bahasa Malaysia` sections. The chunker splits on these and tags each chunk with the right `lang` automatically. `get_compliance_block` extracts the matching section per source file by header regex.
- **`get_compliance_block` dedup is line-granularity**: when merging SC + FIMM + Public Mutual for one language, identical lines (case-insensitive, trimmed) are emitted only once — matters because all three regulators echo the same banned phrases / disclaimer wording. Source labels (e.g. `### Securities Commission Malaysia`) are kept so the agent can attribute.
- **VTT cleanup**: regex strip of `WEBVTT` header, cue numbers (`^\d+$`), timestamps (`HH:MM:SS.mmm --> ...`), and inline cue tags (`<c.colorXXXX>`, `<00:00:01.000>`). Spoken-text lines only.
- **Files vs registry**: corpus walks the filesystem each `reindex`. No package-level registry — adding a new compliance source is just dropping a `.md` in `corpus/compliance/` (with the lang headers) and re-running. `corpus/.index/` is gitignored.
- **`list_proof` schema**: each `corpus/proof/*.md` file is parsed as YAML frontmatter (`quote`, `attribution`, `permission_status`, `persona`) plus the body. Matches the PDPA rule that anything quotable must have explicit permission tracked alongside.

## Consequences

- Adding a new corpus source = drop a file + run `/ingest-corpus`. No code change.
- BM25 implementation is small enough to inspect — no surprises in retrieval ranking.
- Compliance corpus seeded from the EngineerDad Compliance Rulebook; translations are Claude-generated v1 drafts (Shoo to verify the BM disclaimer wording before any paid creative actually ships through these). The rulebook remains at repo root as the canonical English source.
- VTT support means YouTube/podcast transcripts can ingest directly without an external preprocessing step.
