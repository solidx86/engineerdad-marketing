---
description: Show every orchestrator run — runId, stage, status, step count — the read-only run dashboard.
allowed-tools: mcp__orchestrator__status
---

Call `mcp__orchestrator__status` and print `runs` as a table with the columns:

`runId` · `stage` · `status` · `steps` · `updated`

Newest run first (the tool already returns them in that order). Render
`updated` as a human-readable timestamp. If there are no runs, say so plainly.
