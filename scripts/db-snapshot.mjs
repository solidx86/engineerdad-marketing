#!/usr/bin/env node
// Snapshots the live `engineerdad` DB into the current branch's sandbox DB,
// then re-applies Drizzle schema pushes to keep branch schema in sync.
import { execSync } from "node:child_process";
import postgres from "postgres";
import { branchSlug } from "./lib/db-slug.mjs";

process.env.ALLOW_LIVE_DB = "1"; // script reads live DB by design — bypass the branch safety guard

const ROOT = new URL("..", import.meta.url).pathname;

async function main() {
  const slug = branchSlug();

  if (slug === "engineerdad_sb_main") {
    console.log("Nothing to snapshot — already on main.");
    process.exit(0);
  }

  // Verify target sandbox DB exists
  const adminUrl = "postgresql://engineerdad:engineerdad@localhost:5432/postgres";
  const sql = postgres(adminUrl, { max: 1 });
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${slug}`;
    if (rows.length === 0) {
      console.error(`Sandbox DB ${slug} not found. Run: pnpm db:sandbox`);
      process.exit(1);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  const SRC = "engineerdad";
  const TGT = slug;
  const TMP = `/tmp/${slug}.dump`;

  try {
    console.log(`pg_dump ${SRC} → ${TMP} …`);
    execSync(
      `docker exec engineerdad-postgres bash -c "pg_dump --no-owner --no-acl --clean --if-exists -Fc -U engineerdad -d ${SRC} -f ${TMP}"`,
      { stdio: "inherit" }
    );

    console.log(`pg_restore ${TMP} → ${TGT} …`);
    execSync(
      `docker exec engineerdad-postgres bash -c "pg_restore --no-owner --no-acl --clean --if-exists -U engineerdad -d ${TGT} ${TMP}"`,
      { stdio: "inherit" }
    );

    // Re-apply schema pushes (idempotent — ensures branch schema is in sync)
    const sandboxUrl = `postgresql://engineerdad:engineerdad@localhost:5432/${TGT}`;
    const env = { ...process.env, DATABASE_URL: sandboxUrl };
    for (const pkg of ["@engineerdad/store", "@engineerdad/orchestrator", "@engineerdad/analytics"]) {
      console.log(`Pushing schema for ${pkg}…`);
      execSync(`pnpm --filter ${pkg} push`, { env, stdio: "inherit", cwd: ROOT });
    }
  } finally {
    // Clean up dump file (rm -f so it doesn't throw if dump was never created)
    execSync(`docker exec engineerdad-postgres rm -f ${TMP}`, { stdio: "inherit" });
  }

  console.log(`\nSnapshotted engineerdad → ${TGT}`);
}

main().catch((err) => {
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") {
    console.error(`Could not connect to Postgres at localhost:5432. Is it running? Try: pnpm store:up`);
    process.exit(1);
  }
  throw err;
});
