---
description: Fill a data gap. Surfaces Scripts held at HG2 with a kind:gap claim binding (ADR-030), takes human-supplied source material, dispatches the chart-author utility to author the missing dataset + chart(s), shows you a preview, and on your approval promotes the files and re-binds the Script gap → data. Human-invoked, out-of-loop — never part of /loop.
argument-hint: "[runId | scriptId] + source material (file path, pasted text, image path, or URL)"
allowed-tools: Task, Read, Bash, mcp__store__query, mcp__store__get, mcp__store__update, mcp__corpus__list_charts
---

You are running the **gap-fill** utility (ADR-030 data-first claim binding). A
quantitative claim was bound `kind:"gap"` and its Script is HELD at HUMAN GATE 2
because no vetted dataset depicted it. You close that gap from human-supplied
source material, then promote + re-bind so the Script can flow.

This is **out-of-loop and human-gated**: nothing is promoted or re-bound without
the human explicitly approving the previewed candidate.

## 1. Surface the open gaps

Query the held Scripts and list their gap bindings:

```
mcp__store__query({ entity: "Scripts", filter: { runId: "<runId from $ARGUMENTS, or omit for all>" }, fields: ["claimBindings", "scriptEn"] })
```

For each returned Script, inspect `claimBindings` for entries with
`kind === "gap"`. Present a numbered list: Script id · the gap `claim` · its
`gapNote`. If `$ARGUMENTS` names a single scriptId, scope to it. If there are no
open gaps, say so and stop.

> Note: the store filter is column-level, so filter `kind:"gap"` yourself in the
> returned rows (claimBindings is a jsonb array). For a precise pre-check you may
> also run a `docker exec engineerdad-postgres psql` jsonb query (see CLAUDE.md).

## 2. Take the source material

Confirm which gap the human wants to fill and what source they're providing —
a file path, pasted text, an image path, or a URL to research. One gap at a time.

## 3. Dispatch the chart-author

Spawn the `chart-author` agent with: the gap `claim`, its `gapNote`, the holding
Script id, and the source material. It will persist a dataset JSON, derive the
chart YAML(s) under `corpus/data/_pending/`, render a preview PNG, and return the
candidate JSON. **It does not promote or re-bind — that's your job below.**

## 4. Human review (HARD GATE)

`Read` the preview PNG(s) and show the human the candidate: dataset path +
`verification_status`, each chart id + figures + takeaway + preview. If the
chart-author reported the claim is unsupportable, relay that — the right outcome
may be to **drop the claim**, not chart it. Wait for explicit approval. If the
human rejects, leave `_pending/` for iteration and stop.

## 5. Promote (only after approval)

Move the approved files from staging into the live two-layer dirs:

```
git mv corpus/data/_pending/datasets/<id>.json corpus/data/datasets/<id>.json
git mv corpus/data/_pending/charts/<id>.yaml   corpus/data/charts/<id>.yaml
```

**No reindex** — charts/datasets are read by path, never BM25-indexed. Confirm
the chart now resolves: `mcp__corpus__list_charts({ id: "<id>" })`.

## 6. Re-bind gap → data

For the held Script, transform its `claimBindings` per `rebindGapToData`
(packages/shared): find the binding whose `kind:"gap"` claim matches, set
`kind:"data"`, `chartRef:"<id>"`, `figures` (the chart's depicted figures),
`takeaway`, and clear `gapNote`. Persist:

```
mcp__store__update({ entity: "Scripts", id: "<scriptId>", props: { claimBindings: <the rebound array> } })
```

Then re-verify the trace: every figure on the rebound binding must trace to the
chart (the C1 figures-trace the orchestrator will re-run). If the Script now has
**no remaining `kind:"gap"` binding** (`hasOpenGap` is false), it is no longer
held — tell the human it can be approved at HG2 and will flow to produce.

## 7. Report

Summarise: gap filled, dataset + chart promoted (paths), Script re-bound, and
whether the Script still holds other gaps. Commit is the human's call (this
touches git-tracked corpus files).
