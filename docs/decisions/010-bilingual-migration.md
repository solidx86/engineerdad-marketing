# 010 — Trilingual → Bilingual migration (drop ZH)

Status: Accepted
Date: 2026-05-08
Source: TASKS.md Phase 8.15

## Context

The OS originally targeted EN/BM/ZH ("trilingual") on the assumption that Mandarin-speaking parents in Klang Valley were a meaningful audience segment. After Phase 7's run_1 dry-run, the user decided ZH translation was dead weight: no Mandarin audience targeting was planned for the foreseeable future, the ZH compliance corpus needed Shoo's manual verification (additional friction), and every agent generation step was paying a 33% token tax for output that wouldn't ship.

## Decision

Hard-delete every ZH reference across the stack.

### Code

- **Types**: `Lang` enum reduced to `"en" | "ms"`; `Trilingual<T>` / `TrilingualSchema` renamed to `Bilingual<T>` / `BilingualSchema` with the `zh` arm removed (`packages/shared/src/{types,zod}.ts`). All consumers (Brief / Hook / Script / AuthorityArticle / Hypothesis / Learning / PerformanceReport / ContentGenOutput) re-typed.
- **Notion schemas**: stripped 16 ZH properties from `packages/notion-bootstrap/src/schemas.ts` — `Title (ZH)` from `baseProps()` (8 DBs), plus `Body ZH`, `Hook ZH`, `Script ZH`, `CTA ZH`, `Decision Memo ZH`, `Statement ZH`, `Claim ZH`. New migration script `packages/notion-bootstrap/src/migrate-drop-zh.ts` drops them from the live workspace via `notion.databases.update({properties: {<name>: null}})`, which removes the schema property AND clears its data on every existing row.
- **MCP boundary enforcement**: `mcp-servers/notion/src/extract-text.ts` no longer routes ` ZH` / ` (ZH)` suffixes; `extractTextByLang` returns only `{en, ms}` buckets. `mcp-servers/notion/src/index.ts` compliance scan loop iterates `["en", "ms"]`; `no_zh_content` violation kind removed; tool description updated to "EN+BM" wording.
- **Corpus tooling**: `mcp-servers/corpus/src/tokenize.ts` lost CJK detection + char-level tokenization branches; `chunk.ts` lost the `## 中文` header detection + zh char-window slicing; `tools.ts` `LANG_HEADER` no longer maps `zh`. `index.ts` Zod schemas on `search` + `get_compliance_block` accept only `"en" | "ms"`. Corresponding test specs updated.
- **Analytics types**: `mcp-servers/analytics/src/types.ts` `language` enum reduced to `"en" | "ms"`.
- **Compliance scanner test**: `packages/shared/src/compliance.test.ts` zh-specific spec deleted.

### Corpus

- **Compliance corpus**: `## 中文` sections truncated from `corpus/compliance/{sc-malaysia,fimm,public-mutual}.md` (1647 lines → 1155). All 16 zh entries dropped from `corpus/compliance/banned-phrases.yaml`.
- **Course corpus** (`corpus/courses/*.md`, 9 files) and **proof corpus** (`corpus/proof/*.md`, 7 files) had `## 中文` sections truncated. `corpus/proof/credentials.md` had `中文` removed from the "Languages of practice" / "Bahasa amalan" lines.

### Agent prompts

- Renamed `packages/shared/src/prompts/trilingual.md` → `bilingual.md` (rewrite drops zh-Hans rules + ZH date/currency examples).
- `.claude/agents/{brain,targeting,content-gen,media-production,experiment-os}.md` had every `EN/BM/ZH`, `lang: "zh"` parallel call, and `Title (ZH)` requirement stripped.
- `mcp-servers/notion/src/chunk-rich-text.ts` doc comment updated.

### Docs

- `README.md`, the original design spec, and `docs/brief-approval-checklist.md` (lines 57, 61, 63, 103) all converted from trilingual → bilingual phrasing.
- The original design spec's v0.1 changelog entry preserved verbatim with a parenthetical "ZH dropped 2026-05-08" note.

### Data wipe

- The `migrate-drop-zh` script wipes ZH content from all rows including the run_1778212001 ladder (12 Briefs, 4 Scripts, 2 Articles, 1 PerformanceReport, 3 Hypotheses) — irreversible without page-history restore.
- `data/engineerdad.sqlite` `creatives.language` column scanned for `'zh'` rows; deleted to keep schema and data consistent with the `language: "en" | "ms"` Zod enum.

### Verification

- `grep -rE '\b(zh|ZH|trilingual|Trilingual|中文|Mandarin)\b'` across `**/*.ts`, `.claude/agents/*.md`, `corpus/`, top-level docs returns 0 hits outside intentional preservations (migrate-drop-zh script body, the original design spec's v0.1 changelog historical line, this ADR itself).

## Consequences

- ~33% token reduction on every content-gen step (no ZH parallel output).
- Re-introducing ZH requires re-running bootstrap + corpus reindex + agent prompt updates — non-trivial, but the migration script proves the operation is mechanical.
- Build history (DONE.md) and Phase 8.15 historical record retain references to "trilingual" — they record what was true at the time, not the current schema. Future ADR readers should treat ADR-002 + ADR-007 as the current shape.
