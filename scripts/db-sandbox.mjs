#!/usr/bin/env node
// Creates or updates a branch-scoped sandbox DB and writes DATABASE_URL to .env.local.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { branchSlug } from "./lib/db-slug.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

async function createDbIfNeeded(dbName) {
  const adminUrl = "postgresql://engineerdad:engineerdad@localhost:5432/postgres";
  const sql = postgres(adminUrl, { max: 1 });
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) {
      await sql.unsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database: ${dbName}`);
    } else {
      console.log(`Database already exists: ${dbName}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function pushSchemas(dbUrl) {
  const env = { ...process.env, DATABASE_URL: dbUrl };
  for (const pkg of ["@engineerdad/store", "@engineerdad/orchestrator", "@engineerdad/analytics"]) {
    console.log(`Pushing schema for ${pkg}...`);
    execSync(`pnpm --filter ${pkg} push`, { env, stdio: "inherit", cwd: ROOT });
  }
}

function writeEnvLocal(dbUrl) {
  const envLocalPath = resolve(ROOT, ".env.local");
  let content = "";
  if (existsSync(envLocalPath)) {
    content = readFileSync(envLocalPath, "utf8");
    if (/^DATABASE_URL=/m.test(content)) {
      content = content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dbUrl}`);
    } else {
      content += `\nDATABASE_URL=${dbUrl}\n`;
    }
  } else {
    content = `DATABASE_URL=${dbUrl}\n`;
  }
  writeFileSync(envLocalPath, content);
  console.log(`Wrote DATABASE_URL to .env.local → ${dbUrl}`);
}

const dbName = branchSlug();
const dbUrl = `postgresql://engineerdad:engineerdad@localhost:5432/${dbName}`;

try {
  await createDbIfNeeded(dbName);
} catch (err) {
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") {
    console.error(`Could not connect to Postgres at localhost:5432. Is it running? Try: pnpm store:up`);
    process.exit(1);
  }
  throw err;
}
pushSchemas(dbUrl);
writeEnvLocal(dbUrl);

console.log(`\nSandbox ready: ${dbName}`);
console.log(`DATABASE_URL written to .env.local — Vitest will pick this up automatically.`);
