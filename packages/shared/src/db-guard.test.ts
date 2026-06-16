import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { assertDbSafeForBranch } from "./db-guard.js";

// The repo root has a .git directory — use it as a cwd that can detect a branch.
// For tests that need an undetectable branch, pass "/tmp" (no .git ancestor).
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

describe("assertDbSafeForBranch", () => {
  it("throws when pointing at live engineerdad DB on a feature branch", () => {
    expect(() =>
      assertDbSafeForBranch("postgresql://localhost/engineerdad", {
        branch: "feat/x",
      }),
    ).toThrow(/feat\/x/);
  });

  it("thrown error mentions pnpm db:sandbox and pnpm db:snapshot", () => {
    const fn = () =>
      assertDbSafeForBranch("postgresql://localhost/engineerdad", {
        branch: "feat/x",
      });
    expect(fn).toThrow(/pnpm db:sandbox/);
    expect(fn).toThrow(/pnpm db:snapshot/);
  });

  it("allows live engineerdad DB on main", () => {
    expect(() =>
      assertDbSafeForBranch("postgresql://localhost/engineerdad", {
        branch: "main",
      }),
    ).not.toThrow();
  });

  it("allows sandbox DB on a feature branch", () => {
    expect(() =>
      assertDbSafeForBranch("postgresql://localhost/engineerdad_sb_feat_x", {
        branch: "feat/x",
      }),
    ).not.toThrow();
  });

  it("allows _test DB on a feature branch", () => {
    expect(() =>
      assertDbSafeForBranch("postgresql://localhost/engineerdad_test", {
        branch: "feat/x",
      }),
    ).not.toThrow();
  });

  it("allows live engineerdad DB when allowLive: true regardless of branch", () => {
    expect(() =>
      assertDbSafeForBranch("postgresql://localhost/engineerdad", {
        branch: "feat/x",
        allowLive: true,
      }),
    ).not.toThrow();
  });

  it("is a no-op when branch is undetectable (no .git ancestor)", () => {
    expect(() =>
      assertDbSafeForBranch("postgresql://localhost/engineerdad", {
        cwd: "/tmp",
      }),
    ).not.toThrow();
  });

  it("parses full URL with credentials, port, and query string correctly", () => {
    // URL: postgresql://user:pass@host:5432/engineerdad?sslmode=require
    // dbName should be "engineerdad" → throws on feat/x branch
    expect(() =>
      assertDbSafeForBranch(
        "postgresql://user:pass@host:5432/engineerdad?sslmode=require",
        { branch: "feat/x" },
      ),
    ).toThrow(/feat\/x/);

    // Sandbox variant with same URL shape should pass
    expect(() =>
      assertDbSafeForBranch(
        "postgresql://user:pass@host:5432/engineerdad_sb_feat_x?sslmode=require",
        { branch: "feat/x" },
      ),
    ).not.toThrow();
  });

  it("detects the real branch from REPO_ROOT when cwd is provided", () => {
    // Verifies detectBranch walks the live .git tree and finds the current
    // branch from the real repo root. The OUTCOME depends on which branch
    // the test runs from: on main the live DB is allowed (no throw); on any
    // other branch the guard refuses the live DB (throws). Both paths prove
    // detectBranch worked — we just assert the right outcome per branch.
    const head = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT }).toString().trim();
    // In a PR, CI checks out a detached merge ref, so abbrev-ref reports "HEAD" and
    // detectBranch() reads a bare SHA → returns null → the guard ALLOWS the live DB
    // (db-guard.ts: `if (branch === null) return`). So detached HEAD behaves like main
    // here (no throw); only a real named non-main branch (local dev) refuses the live DB.
    const allowsLive = head === "main" || head === "HEAD";
    if (allowsLive) {
      expect(() =>
        assertDbSafeForBranch("postgresql://localhost/engineerdad", { cwd: REPO_ROOT }),
      ).not.toThrow();
    } else {
      expect(() =>
        assertDbSafeForBranch("postgresql://localhost/engineerdad", { cwd: REPO_ROOT }),
      ).toThrow(/Refusing to connect to live engineerdad DB/);
    }
  });

  it("allows live engineerdad DB when ALLOW_LIVE_DB=1 is set, even on non-main branch", () => {
    const oldEnv = process.env.ALLOW_LIVE_DB;
    try {
      process.env.ALLOW_LIVE_DB = "1";
      expect(() =>
        assertDbSafeForBranch("postgresql://localhost/engineerdad", {
          branch: "feat/x",
        }),
      ).not.toThrow();
    } finally {
      process.env.ALLOW_LIVE_DB = oldEnv;
    }
  });
});
