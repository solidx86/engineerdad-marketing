---
description: Mint a fresh orchestrator run and drive it to the Decision Memo + 12 Briefs in the store. Stops at HUMAN GATE 1 (Brief approval in the webapp). A scoped entry to the /loop conductor — the synthesis front door.
argument-hint: "[run args, e.g. --window=7d --budget=MYR:200/day]"
allowed-tools: Task, mcp__orchestrator__*
---

A scoped entry to the closed-loop conductor — the synthesis front door.
**Mint a fresh run** and drive it exactly per the procedure in
`.claude/commands/loop.md`: call `mcp__orchestrator__plan` with
`{ args: "$ARGUMENTS" }` (omit `args` when `$ARGUMENTS` is empty), then
execute → verify → advance, repeating until a step says STOP.

The run walks tracking → analytics → synthesize → brief and STOPs at HUMAN
GATE 1, where the human approves the 12 Briefs in the webapp
(the orchestrator's gate message carries the URL — REVIEW_UI_URL,
default localhost:3030). Follow loop.md's loop
body and rules verbatim.
