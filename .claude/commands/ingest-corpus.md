---
description: Re-index the local /corpus directory (compliance + courses + proof + knowledge). Writes corpus/.index/chunks.jsonl + a BM25 sidecar. Run this after dropping new files into corpus/.
allowed-tools: mcp__corpus__reindex
---

Call `mcp__corpus__reindex` to rebuild the corpus index from `/corpus`. After it returns, summarize: number of files indexed, chunk count, any errors. Do not call any other tool.
