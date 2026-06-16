#!/usr/bin/env node
// One-shot lookup of Meta ad-locale IDs for English (US) and Malay.
// Run once at implementation time; paste the IDs into plan-distribution.ts.
// Re-run anytime Meta's API changes.
//
// Usage:  node scripts/lookup-meta-locale-ids.mjs
// Requires: META_TOKEN in .env or .env.local

import { readFileSync } from "node:fs";

// Minimal .env loader (no dotenv dependency at the workspace root).
// .env.local overrides .env if both define the same key.
for (const file of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // file missing — fine
  }
}

const TOKEN = process.env.META_TOKEN;
if (!TOKEN) {
  console.error("META_TOKEN missing from environment (.env or .env.local).");
  process.exit(1);
}

async function lookup(q) {
  const url = `https://graph.facebook.com/v18.0/search?type=adlocale&q=${encodeURIComponent(q)}&access_token=${TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Lookup failed for "${q}": ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();
  return json.data ?? [];
}

const english = await lookup("English");
const malay = await lookup("Malay");

console.log("\n=== Candidates for English (look for 'English (US)') ===");
for (const r of english.slice(0, 15)) console.log(`  ${r.key}\t${r.name}`);

console.log("\n=== Candidates for Malay ===");
for (const r of malay.slice(0, 15)) console.log(`  ${r.key}\t${r.name}`);

console.log("\nPaste the chosen `key` values into LOCALE_ID in");
console.log("packages/orchestrator/src/distribute/plan-distribution.ts");
