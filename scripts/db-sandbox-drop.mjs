#!/usr/bin/env node
// Lists and drops sandbox DBs whose git branch no longer exists locally.
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import postgres from "postgres";
import { slugFromBranch } from "./lib/db-slug.mjs";

async function main() {
  const adminUrl = "postgresql://engineerdad:engineerdad@localhost:5432/postgres";
  const sql = postgres(adminUrl, { max: 1 });

  try {
    const sandboxDbs = await sql`
      SELECT datname FROM pg_database
      WHERE datname LIKE 'engineerdad_sb_%'
      ORDER BY datname
    `;

    if (sandboxDbs.length === 0) {
      console.log("No sandbox DBs found.");
      return;
    }

    const branches = execSync("git branch --format=%(refname:short)", { encoding: "utf8" })
      .split("\n").filter(Boolean);

    const branchSlugs = new Set(branches.map(b => slugFromBranch(b)));

    const orphans = sandboxDbs.map(r => r.datname).filter(name => !branchSlugs.has(name));

    if (orphans.length === 0) {
      console.log("No orphaned sandbox DBs found.");
      return;
    }

    console.log("Orphaned sandbox DBs (branch no longer exists locally):");
    orphans.forEach(name => console.log(`  - ${name}`));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve =>
      rl.question("\nDrop all of the above? [y/N] ", resolve)
    );
    rl.close();

    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }

    for (const name of orphans) {
      await sql.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      console.log(`Dropped: ${name}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(err => {
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") {
    console.error(`Could not connect to Postgres at localhost:5432. Is it running? Try: pnpm store:up`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
