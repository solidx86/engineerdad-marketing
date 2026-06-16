# 001 — Toolchain & workspace

Status: Accepted
Date: 2026-05-06
Source: TASKS.md Phase 0

## Context

The OS is a multi-package TypeScript monorepo containing five MCP servers, a shared package, and a Notion bootstrap script. Day-1 needed a buildable workspace with strict typing, linting, and tests stood up — not stubbed — so downstream phases couldn't accumulate quality debt.

## Decision

- **pnpm 9.15.4** pinned via `packageManager` field — provisioned automatically by corepack (no global pnpm install needed).
- **Node ≥ 20.10** declared in `engines`.
- **Workspace is ESM** — root `package.json` has `"type": "module"`. ESLint flat config and Vitest config are ESM by default.
- **Lint/test tooling stood up now**, not stubbed: ESLint 9 flat config (`@eslint/js` + `typescript-eslint` + `eslint-config-prettier`), Prettier 3 (`.prettierrc.json` + `.prettierignore`), Vitest 2 (`vitest.config.ts` with `passWithNoTests: true` so empty-workspace runs pass).
- **`tsconfig.base.json`**: strict + NodeNext + ES2022, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `declaration` + source maps on. Workspace packages will extend this.
- **Root scripts added beyond TASKS list**: `format`, `format:check`, `lint:fix`, `test:watch`, `typecheck` (`pnpm -r --parallel typecheck`).
- **Build script** is `pnpm -r --parallel build` — no-op until packages exist (expected). NB: parallel build races on `@engineerdad/shared`; use sequential `pnpm -r build` for clean rebuilds.

## Consequences

- All workspace packages extend `tsconfig.base.json`. Strict-mode bugs surface at compile time, not runtime.
- ESM-only — CommonJS dependencies need explicit interop. So far no friction; native fetch + `node:sqlite` keep dep count low.
- pnpm corepack bootstrap means a fresh clone needs no pre-install — `pnpm install` works on first invocation.
