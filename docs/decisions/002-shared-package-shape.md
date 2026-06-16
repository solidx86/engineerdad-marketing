# 002 — Shared package shape

Status: Accepted
Date: 2026-05-06
Source: TASKS.md Phase 1
Supersedes (in part): trilingual schema replaced by bilingual — see ADR-010

## Context

`@engineerdad/shared` is the canonical home for Zod types, the compliance scanner, and prompt fragments. Every downstream package and every agent imports from here. Schema decisions made here propagate to Notion writes, Brain reasoning, and `/reflect` grading — so they're load-bearing.

## Decision

- **Persona is a strict Zod enum** with 8 starter values (`engineer_dad_archetype`, `young_parents_25_35`, `established_parents_35_45`, `single_income_conservative`, `dual_income_growth`, `pre_retirement_prs_focus`, `business_owner_self_employed`, `salaried_professional_top_up`). Brain proposes new personas through the Decision Memo, not silently in a Brief — extensions land via code change.
- **Bilingual fields** are `{ en, ms }` objects (Zod `BilingualSchema`, each arm `min(1)`). Notion's two-property layout is mapped at the MCP boundary; agents always work with the object shape. *(Originally trilingual `{en, ms, zh}` — see ADR-010 for the ZH drop.)*
- **`HookBankSchema`** enforces both count (`≥30`) AND coverage of all six emotional registers (`fear | aspiration | curiosity | proof | contrarian | identity`) via `superRefine`. **`ValueSegmentBankSchema`** enforces `≥6`.
- **YAML loader**: `yaml@^2` (runtime dep of `@engineerdad/shared`). Rules cached after first load; cache keyed by path with `clearComplianceRulesCache()` for tests.
- **Package shape**: ESM, exports map (`. / ./types / ./zod / ./compliance / ./prompts/*`). Prompts shipped as raw `.md` under `src/prompts/` so agents can import them by path. Zod is a peer dep + dev dep (so the package builds standalone but consumers control the version).

## Consequences

- New personas require a code change + PR review — intentional friction; prevents Brain from silently fragmenting the audience model.
- `BilingualSchema` is the canonical shape for all writes; Notion column-name suffixes (` EN` / ` BM`) only matter at the notion MCP boundary.
- `superRefine` failures on `HookBankSchema` halt content-gen at the agent boundary — no Notion write happens with an under-bank.
