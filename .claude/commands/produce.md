---
description: Resume an orchestrator run through the produce stage — creative-director + render workers decompose approved Scripts into Creative Variants with shotlists, specs, and rendered assets. Stops at HUMAN GATE 3 (Variant approval). A scoped entry to the /loop conductor.
argument-hint: "--run=<id>"
allowed-tools: Task, mcp__orchestrator__*
---

A scoped entry to the closed-loop conductor — the **produce** escape hatch.
Parse the runId from `$ARGUMENTS` (`--run=<id>`) and drive that run exactly per
the procedure in `.claude/commands/loop.md`: call `mcp__orchestrator__plan`
with `{ runId }`, then execute → verify → advance, repeating until a step says
STOP.

The run must already have cleared HUMAN GATE 2. The orchestrator owns
sequencing; you will STOP at HUMAN GATE 3 (the produce gate). Follow loop.md's
loop body and rules verbatim.
