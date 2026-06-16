#!/usr/bin/env node
// Frames-only test harness for the reel-render-worker.
//
// Usage:   pnpm run test:reel-frames <fixture-name> [--copy] [--open]
// Example: pnpm run test:reel-frames chart-emphasis --copy
//
// Assembles a FRAMES-ONLY spawn prompt (reel-render-worker.md + the fixture)
// and prints a paste-able Task() call. The spawned worker builds + renders
// each chart/visual frame at 1080×1920 and STOPS before HeyGen (no upload,
// no generate_reel, no store writes). Reuses the live MCP stack — no SDK.
//
// PNGs land at data/assets/test-reel-<fixture>/<variantId>/<scene>.png

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = new Set(args.filter((a) => a.startsWith("--")));
const fixtureDir = resolve(repoRoot, "scripts/fixtures/reel-worker");

if (positional.length !== 1) {
  console.error("usage: pnpm run test:reel-frames <fixture-name> [--copy] [--open]");
  if (existsSync(fixtureDir)) {
    console.error("available fixtures:");
    for (const f of readdirSync(fixtureDir)) if (f.endsWith(".json")) console.error(`  - ${f.replace(/\.json$/, "")}`);
  }
  process.exit(1);
}

const name = positional[0];
const fixturePath = resolve(fixtureDir, `${name}.json`);
const promptPath = resolve(repoRoot, "corpus/templates/worker-prompts/reel-render-worker.md");
for (const p of [fixturePath, promptPath]) {
  if (!existsSync(p)) { console.error(`error: not found at ${p}`); process.exit(1); }
}

const workerPrompt = readFileSync(promptPath, "utf8");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
fixture.runId = `test-reel-${name}`;
fixture.id = "test-row";
fixture.variantId = createHash("sha256").update(`${fixture.scriptId}|Reel|9:16`).digest("hex").slice(0, 12);
fixture.resumeFromJobId = null;

const spawnPrompt = `${workerPrompt}

---

## FRAMES-ONLY MODE

Operate in frames-only mode (see "Frames-only harness mode"): render every chart/visual frame at
1080×1920, run the visual-QA pass, and STOP before Step 3. Do not call HeyGen or the store.

## Spawn-time inputs

\`\`\`json
${JSON.stringify(fixture, null, 2)}
\`\`\`

Return only the frames-only JSON described in the prompt. No surrounding prose.`;

const taskCall = `Task({
  subagent_type: "general-purpose",
  description: "Test reel frames (${name})",
  prompt: \`${spawnPrompt.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`
})`;

const outDir = resolve(repoRoot, "tmp/test-output", `reel-${name}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "spawn-prompt.md"), spawnPrompt);

console.log("=".repeat(72));
console.log(`REEL FRAMES-ONLY HARNESS — fixture: ${name}`);
console.log("=".repeat(72));
console.log(`Spawn prompt: tmp/test-output/reel-${name}/spawn-prompt.md`);
console.log(`Renders land at: data/assets/${fixture.runId}/${fixture.variantId}/<scene>.png`);
console.log("Paste this into a Claude Code conversation with: Task, Read, mcp__static-renderer__*\n");
console.log("─".repeat(72));
console.log(taskCall);
console.log("─".repeat(72));

if (flags.has("--copy")) {
  const r = spawnSync("pbcopy", { input: taskCall });
  console.log(r.status === 0 ? "✓ copied to clipboard" : "⚠ pbcopy unavailable");
}
if (flags.has("--open")) spawnSync("open", [outDir]);
