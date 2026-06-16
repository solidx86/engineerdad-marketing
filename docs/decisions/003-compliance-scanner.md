# 003 — Compliance scanner

Status: Accepted
Date: 2026-05-06 (initial), 2026-05-08 (negation-aware patch)
Source: TASKS.md Phase 1 §1.4 + Phase 8.11

## Context

The OS produces marketing copy for Public Mutual unit trusts and PRS in a Malaysian regulatory environment governed by SC, FIMM, and Public Mutual's internal marketing guidelines. Banned phrases (guaranteed returns, risk-free, get-rich-quick) and required disclaimers (consultant credential, risk warning, prospectus availability) are non-negotiable. The scanner is the last automated check before any Notion content row gets written.

## Decision

### Core rules

- **Compliance scanner hard-fails on three required disclaimers per language**: `consultant_credential` (Shoo Kyuk Wei + Public Mutual + UTC|PRS|FIMM), `risk_warning`, `prospectus_availability`. All three patterns live in `corpus/compliance/banned-phrases.yaml` under `required_disclaimers:` so they're editable without code changes.
- **`proofRefs` 80% rule is batch-level**, not per-script. Per-Script Zod schema permits empty `proofRefs` (brand spots stay valid); `validateScriptBatch(scripts, minRatio=0.8)` enforces the §8 ratio at the boundary and is re-checked by Brain in the Decision Memo's Self-Critique.
- **Banned phrases include language-specific entries** (BM: `pulangan dijamin`, `tiada risiko`, `cepat kaya`) plus the global product-scope ban (forex / crypto / day-trading / individual stock-picking).

### Negation-aware opt-in (8.11 patch)

- **Opt-in `negation_aware: true` flag on `BannedRule`** (`packages/shared/src/compliance.ts`). When set, a banned-pattern match is suppressed if a negation token (`not`, `no`, `never`, `cannot`, `won't`, `doesn't`, `tidak`, `bukan`, `tiada`, `jangan`) appears within `NEGATION_WINDOW=80` chars before the match.
- **Two SC-endorsement patterns** in `corpus/compliance/banned-phrases.yaml` carry the flag — keeps the canonical SC §8.18 disclaimer ("does not amount to nor indicate that the SC has recommended or endorsed") legal while still flagging positive claims ("the SC endorses our fund", "endorsed by the Securities Commission").
- **Doctrine: the flag is opt-in.** "Guaranteed returns" / "risk-free" / etc. stay strictly literal because negating them in marketing copy is itself a compliance smell.

## Consequences

- Adding a new banned phrase = YAML edit, no code change.
- Adding a new required disclaimer = YAML edit + a re-test (5 vitest specs cover the canonical cases).
- The negation-aware flag is the only escape hatch — every other banned pattern remains literal. Reviewers should suspect any new `negation_aware: true` line in PRs.
- 80% proof rule cannot be enforced per-row at MCP boundary because brand spots are legitimately proofless; Brain's Self-Critique step is the second checkpoint.
