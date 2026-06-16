# corpus/knowledge

Technical knowledge artifacts for the EngineerDad domain (Public Mutual
unit trust + PRS). See spec:
`docs/superpowers/specs/2026-05-29-pmb-corpus-expansion-design.html`.

Each entry is a markdown file with YAML frontmatter:

```yaml
---
cluster: mechanics       # mechanics | tax | portfolio | primitive
granularity: concept     # concept | fund
source_type: public      # public | synthesized
source_ref: "PMB Master Prospectus 2025-09-01 p.42"
verified_at: 2026-05-29
lang_status: en_only     # en_only | both
related: [a-fee-schedule, a-switching-matrix]
---
```

Body uses the same `## English` / `## Bahasa Malaysia` section
convention as the rest of `/corpus`. EN ships first; BM follows as a
separate pass.

Source-type rules:
- `public` — every claim must cite a real, verifiable source.
- `synthesized` — plausible scenario patterns. **Never frame as a real
  client case.** Downstream content must wrap as "imagine / scenario /
  example."

After dropping files in here, run the `/ingest-corpus` slash command (or
the `reindex` MCP tool) to refresh the BM25 index. The index lives in
`corpus/.index/` and is gitignored — see `../README.md`.
