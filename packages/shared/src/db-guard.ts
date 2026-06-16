import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";

export interface GuardOpts {
  /** Explicit branch override (used by tests). */
  branch?: string | null;
  /** Skip the guard entirely (used by tests / migrations with explicit intent). */
  allowLive?: boolean;
  /** Starting directory for .git/HEAD walk (defaults to process.cwd()). */
  cwd?: string;
}

/**
 * Throws if `databaseUrl` points at the bare `engineerdad` live database while
 * running on a non-main branch.  Silent on suffixed databases (_sb_*, _test, …).
 */
export function assertDbSafeForBranch(
  databaseUrl: string,
  opts: GuardOpts = {},
): void {
  const allowLive = opts.allowLive ?? process.env.ALLOW_LIVE_DB === "1";
  if (allowLive) return;

  const dbName = parseDbName(databaseUrl);
  if (dbName !== "engineerdad") return; // any suffixed DB is safe

  const branch =
    opts.branch !== undefined
      ? opts.branch
      : detectBranch(opts.cwd ?? process.cwd());

  if (branch === null) return; // CI / production / no .git
  if (branch === "main") return;

  throw new Error(
    `Refusing to connect to live engineerdad DB from branch ${branch}. ` +
      `Run: pnpm db:sandbox && pnpm db:snapshot, or set ALLOW_LIVE_DB=1.`,
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Extract the database name from a postgres connection URL. */
function parseDbName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  // pathname is like "/dbname" — strip the leading slash.
  // URL already separates query string from pathname, so no split needed.
  return url.pathname.replace(/^\//, "");
}

/**
 * Walk up the directory tree from `cwd` looking for a `.git` entry.
 * Returns the branch name, or `null` if not found / detached HEAD.
 * Worktree-aware: when `.git` is a file (as in `git worktree add`), resolves
 * the real gitdir from its "gitdir: ..." pointer before reading HEAD.
 */
function detectBranch(cwd: string): string | null {
  for (let dir = cwd; ; ) {
    const gitEntry = join(dir, ".git");
    if (existsSync(gitEntry)) {
      const gitdir = resolveGitdir(gitEntry);
      if (gitdir === null) return null;
      const headPath = join(gitdir, "HEAD");
      if (!existsSync(headPath)) return null;
      const contents = readFileSync(headPath, "utf8").trim();
      const match = contents.match(/^ref: refs\/heads\/(.+)$/);
      if (match?.[1]) return match[1];
      return null; // detached HEAD
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Given a path to a `.git` entry, return the actual git directory that contains
 * `HEAD`. For a normal repo `.git` is a directory — return it as-is. For a
 * worktree `.git` is a file containing `gitdir: /abs/path/to/worktree-gitdir`.
 */
function resolveGitdir(gitEntry: string): string | null {
  try {
    if (statSync(gitEntry).isDirectory()) return gitEntry;
    // Worktree file: "gitdir: /absolute/path/to/.git/worktrees/<name>"
    const contents = readFileSync(gitEntry, "utf8").trim();
    const m = contents.match(/^gitdir:\s*(.+)$/);
    if (!m?.[1]) return null;
    const ref = m[1].trim();
    return isAbsolute(ref) ? ref : join(dirname(gitEntry), ref);
  } catch {
    return null;
  }
}
