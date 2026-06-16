---
description: Resume an orchestrator run through the post-approval segment — schedule, experiment design, and routing approved content to its platforms (YouTube unlisted, engineerdad-site draft; Meta-paid manual posting pack by default). Completes with no human gate; Meta-paid produces a manual posting pack at /posting-pack/<runId>. A scoped entry to the /loop conductor.
argument-hint: "--run=<id>"
allowed-tools: Task, mcp__orchestrator__*
---

A scoped entry to the closed-loop conductor — the **distribute** escape hatch.
Parse the runId from `$ARGUMENTS` (`--run=<id>`) and drive that run exactly per
the procedure in `.claude/commands/loop.md`: call `mcp__orchestrator__plan`
with `{ runId }`, then execute → verify → advance, repeating until a step says
STOP.

The run must already have cleared HUMAN GATE 3. After HG3 the orchestrator
walks schedule → experiment → distribute as one segment; the distribute stage
routes each approved row to its destination MCP and then **completes — there is
no human gate**. Under the default `META_PAID_MODE=manual` the Meta-paid rows
are recorded as skipped ("manual posting pack") and the operator posts them by
hand from `http://localhost:3030/posting-pack/<runId>`. Channel filtering and
dry-run are run-creation params, not resume flags. Follow loop.md's loop body
and rules verbatim.
