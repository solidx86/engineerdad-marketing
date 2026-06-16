---
description: Summarise the latest analytics signal for a window; with --run, also read out that run's concluded experiment. An off-loop brain operation.
argument-hint: "[--window=Nd] [--run=<id>]"
allowed-tools: Task, mcp__experiment__readout
---

An off-loop analysis pass — not a loop stage.

1. If `$ARGUMENTS` carries `--run=<id>`, call `mcp__experiment__readout` for
   that run's experiment and keep the result. (Skip if there is no concluded
   experiment for the run.)
2. Spawn the `brain` subagent (`subagent_type=brain`) with a prompt instructing
   it to read the analytics signal for the window in `$ARGUMENTS` (default 7d) —
   `top_creatives`, `cost_per_angle`, and decay curves for the top spenders —
   and write a short findings summary. If a readout result is available from
   step 1, fold it in. When `--run` is given, append the findings to that run's
   PerformanceReport.

This is an analysis pass — do not run the full 9-step scaffold, do not dispatch.
