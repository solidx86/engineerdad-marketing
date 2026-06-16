---
description: Run one closed-loop cycle from a fresh orchestrator run — tracking → analytics → synthesize → brief. Stops at HUMAN GATE 1 (Brief approval in the review UI at localhost:3030). A scoped entry to the /loop conductor.
argument-hint: "[run args, e.g. --window=7d --budget=MYR:200/day]"
allowed-tools: Task, mcp__orchestrator__*
---

A scoped entry to the closed-loop conductor. **Mint a fresh run** and drive it
exactly per the procedure in `.claude/commands/loop.md`: call
`mcp__orchestrator__plan` with `{ args: "$ARGUMENTS" }` (omit `args` when
`$ARGUMENTS` is empty), then execute → verify → advance, repeating until a step
says STOP.

The orchestrator owns sequencing — the live registry walks tracking → analytics
→ synthesize → brief and STOPs at HUMAN GATE 1. Follow loop.md's loop body and
rules verbatim: never reshape worker output before verify, never invent a
runId, retry a failed step at most once. Subsequent gates progress via
`/content`, `/produce`, `/distribute` — or another `/loop`.
