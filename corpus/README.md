# corpus/

The local knowledge substrate for the Marketing OS — compliance rules,
courses, proof assets, fund/PMB knowledge, and templates. Feeds the
`brain`, `brief-writer`, `content-writer`, and `creative-director` agents
via the `@engineerdad/corpus` package and the `corpus` MCP server.

## The search index is NOT committed

`corpus/.index/` (the `chunks.jsonl` + BM25 sidecar that power `/corpus`
search) is a **build artefact** and is gitignored. A fresh checkout has no
index — search returns empty until you build one. Missing index is a soft
fail (loaders return empty results, no crash), so nothing breaks; search is
just silent until you run:

```
/ingest-corpus        # the slash command — re-indexes the whole corpus/ tree
```

or call the `reindex` MCP tool. Run it after a fresh clone, and again any
time you add or edit files under `corpus/`.

## Layout

| Dir | Contents |
|---|---|
| `compliance/` | FIMM/SC compliance rules + claim phrasebank |
| `courses/` | Course transcripts / educational source material |
| `proof/` | Proof assets (calculator outputs, MFR snapshots) cited in Briefs |
| `data/` | Machine-readable source data behind the proof files |
| `knowledge/` | Technical PMB/PRS knowledge entries — see `knowledge/README.md` |
| `templates/` | Worker + content templates |
