#!/usr/bin/env node
// CI lint: if any packages/*/src/schema.ts is changed in the last commit,
// the corresponding packages/*/drizzle/ must also contain new/changed SQL files.
import { execSync } from "node:child_process";

// Diff the last commit against its parent. On a root commit (e.g. a squashed
// initial public-release commit) there is no HEAD~1, so fall back to git's
// empty tree — every file in the commit is then treated as added, which keeps
// the schema+migration "shipped together" check meaningful instead of crashing.
function diffBase() {
  try {
    execSync("git rev-parse --verify --quiet HEAD~1", { stdio: "ignore" });
    return "HEAD~1";
  } catch {
    return execSync("git hash-object -t tree /dev/null", { encoding: "utf8" }).trim();
  }
}

const changed = execSync(`git diff --name-only ${diffBase()} HEAD`, { encoding: "utf8" })
  .split("\n").filter(Boolean);

const PACKAGES = ["store", "orchestrator", "analytics"];
let failed = false;

for (const pkg of PACKAGES) {
  const schemaChanged = changed.includes(`packages/${pkg}/src/schema.ts`);
  if (!schemaChanged) continue;

  const migrationChanged = changed.some(
    f => f.startsWith(`packages/${pkg}/drizzle/`) && f.endsWith(".sql")
  );

  if (!migrationChanged) {
    console.error(
      `ERROR: packages/${pkg}/src/schema.ts was modified but no new SQL migration found in packages/${pkg}/drizzle/.\n` +
      `Run \`pnpm db:generate\` and commit the generated SQL alongside schema.ts.`
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("Migration check passed.");
