---
description: Grade the prior cycle's Hypotheses (Confirmed | Refuted | Inconclusive), promote ≥2-confirmed to Learnings, and write a Self-Critique onto the prior PerformanceReport. An off-loop brain operation.
argument-hint: "--run=<id>"
allowed-tools: Task
---

Spawn the `brain` subagent (`subagent_type=brain`) with a prompt instructing it to:

Run the **§B-step-2 Reflect procedure** for the run named in `$ARGUMENTS`
(`--run=<id>`). For each Open Hypothesis from that run's Decision Memo: compare
predicted range vs actual outcome, apply the single-ad filter, set `Status`
(Confirmed | Refuted | Inconclusive), append to `Predictions History`, update
`Calibration Score`, and promote any Hypothesis confirmed across ≥2 independent
runs to a Learning. Then write the `Self-Critique` paragraph onto that run's
PerformanceReport.

Reflect only — do **not** run the full 9-step scaffold and do **not** dispatch
anything. The orchestrator owns loop sequencing.

## Tri-state branching on `experimentStatus`

Read `experimentStatus` from the prior cycle's `Experiments` row (the
tri-state column added in B-025). Branch:

- `full` — every cell had variants; grade all cells; standard Hypothesis
  graduation pass.
- `degraded` — ≥2 cells had variants, ≥1 empty; grade only the cells
  with variants; mark un-populated cells `inconclusive — no data` so
  the comparison is honest about what was actually tested.
- `single-cell` — exactly 1 cell had variants; **skip Hypothesis
  graduation entirely.** A single cell is not a comparison; nothing
  can be confirmed or refuted. Write the Performance Report's "what
  we learned" section as a single-arm observation (uplift vs baseline
  if baseline exists; otherwise no graduation signal this cycle).
- `broken` — this should not be reached (verify-experiment fails
  closed on `broken`). If you see it, halt and ask the operator —
  the upstream verifier guarantee has been bypassed.
