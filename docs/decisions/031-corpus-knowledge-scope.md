# ADR-031: Corpus knowledge scope + universal frontmatter

Status: Accepted
Date: 2026-05-29
Note: Renumbered from ADR-029 (duplicate number with the reel-visual-scenes ADR); content unchanged. The reel-visual-scenes ADR keeps 029.

## Context

`/corpus` currently supports three scopes (`compliance | courses | proof`).
Only `proof/*.md` carries frontmatter (persona, quote, attribution,
permission_status). Search filters by `scope` and `lang` only.

The PMB corpus expansion (see
`docs/superpowers/specs/2026-05-29-pmb-corpus-expansion-design.html`)
needs to ingest ~40 PMB-specific knowledge entries spanning three
clusters (mechanics, tax, portfolio), each tagged by `cluster`,
`granularity` (concept | fund), and `source_type` (public | synthesized).

## Decision

1. Add `knowledge` to the `Scope` enum. Entries live under
   `corpus/knowledge/`.
2. Adopt YAML frontmatter universally across all corpus markdown files.
   Recognised optional fields on every file:
   - `cluster` — `mechanics | tax | portfolio | primitive`
   - `granularity` — `concept | fund`
   - `source_type` — `public | synthesized`
   - `source_ref` — citation string
   - `verified_at` — ISO date
   - `related` — list of related entry IDs
   - `lang_status` — `en_only | both`
3. Reindex parses frontmatter once per file and attaches the fields to
   every `Chunk` produced from that file.
4. `SearchInput` gains optional `cluster | granularity | source_type`
   post-filters, mirroring the existing `scope | lang` filter at
   `packages/corpus/src/tools.ts:45`.
5. Existing `proof/*.md` frontmatter (`persona`, `quote`, etc.) is
   unaffected — `listProof` keeps its own parsing path.

## Consequences

- New `knowledge` scope is recognised by `scopeFromPath` in reindex.
- BM25 index is unchanged in shape; new metadata is carried alongside
  on the `Chunk` record.
- Search remains scope-and-lang-first; new filters are additive.
- No migration of existing files required — frontmatter fields are
  optional and default to undefined.
