---
description: Resume an orchestrator run through the post-approval segment — schedule, factorial experiment design (70/20/10 allocation), and distribution. Completes with no human gate; Meta-paid produces a manual posting pack at /posting-pack/<runId>. A scoped entry to the /loop conductor.
argument-hint: "--run=<id>"
allowed-tools: Task, mcp__orchestrator__*
---

A scoped entry to the closed-loop conductor — the **experiment** escape hatch.
Parse the runId from `$ARGUMENTS` (`--run=<id>`) and drive that run exactly per
the procedure in `.claude/commands/loop.md`: call `mcp__orchestrator__plan`
with `{ runId }`, then execute → verify → advance, repeating until a step says
STOP.

The run must already have cleared HUMAN GATE 3. After HG3 the orchestrator
walks schedule → experiment → distribute as one segment and then **completes —
there is no human gate** (ADR-015 amendment). Under the default
`META_PAID_MODE=manual` the Meta-paid ads are posted by hand from
`http://localhost:3030/posting-pack/<runId>`. Follow loop.md's loop body and
rules verbatim.
