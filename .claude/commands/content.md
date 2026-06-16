---
description: Resume an orchestrator run through the content stage — content-writer authors hook banks, scripts, and AEO/GEO articles from the run's approved Briefs. Stops at HUMAN GATE 2 (Script approval). A scoped entry to the /loop conductor.
argument-hint: "--run=<id>"
allowed-tools: Task, mcp__orchestrator__*
---

A scoped entry to the closed-loop conductor — the **content** escape hatch.
Parse the runId from `$ARGUMENTS` (`--run=<id>`) and drive that run exactly per
the procedure in `.claude/commands/loop.md`: call `mcp__orchestrator__plan`
with `{ runId }`, then execute → verify → advance, repeating until a step says
STOP.

The run must already have cleared HUMAN GATE 1. The orchestrator owns
sequencing; you will STOP at HUMAN GATE 2 (the content gate). Follow loop.md's
loop body and rules verbatim.
