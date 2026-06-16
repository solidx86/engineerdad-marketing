#!/usr/bin/env node
// Test harness for the render-worker.
//
// Usage:   pnpm run test:worker <fixture-name> [--copy]
// Example: pnpm run test:worker feed-1x1-simple --copy
//
// What it does:
//   1. Reads the worker prompt template at corpus/templates/worker-prompts/render-worker.md
//   2. Reads the fixture JSON at scripts/fixtures/static-worker/<fixture-name>.json
//   3. Assembles a complete spawn-prompt body
//   4. Prints a copy-pasteable Task() call you can paste into a Claude Code
//      conversation (the conversation must have access to: Task,
//      mcp__static-renderer__render_html_to_png, Read, Skill).
//
// Why this shape (no Anthropic SDK call):
//   The Claude Agent SDK isn't a project dep, and using it from Node would
//   require ANTHROPIC_API_KEY plus mirroring the MCP server registration.
//   Pasting into an existing Claude Code conversation reuses the live MCP
//   stack and Skill tool — zero new infra, immediate feedback.
//   Upgrade to a fully-automated SDK-driven runner when iteration frequency
//   justifies the extra plumbing.
//
// Output:
//   PNGs land at data/assets/test-run-<fixture>/<variantId>/<scene>.png
//   (use `--open` to reveal the directory in Finder once renders complete)

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = new Set(args.filter((a) => a.startsWith("--")));

if (positional.length !== 1) {
  console.error("usage: pnpm run test:worker <fixture-name> [--copy] [--open]");
  console.error("");
  console.error("available fixtures:");
  const fixtureDir = resolve(repoRoot, "scripts/fixtures/static-worker");
  if (existsSync(fixtureDir)) {
    const { readdirSync } = await import("node:fs");
    for (const f of readdirSync(fixtureDir)) {
      if (f.endsWith(".json")) console.error(`  - ${f.replace(/\.json$/, "")}`);
    }
  }
  process.exit(1);
}

const fixtureName = positional[0];
const fixturePath = resolve(repoRoot, "scripts/fixtures/static-worker", `${fixtureName}.json`);
const promptPath = resolve(repoRoot, "corpus/templates/worker-prompts/render-worker.md");

if (!existsSync(fixturePath)) {
  console.error(`error: fixture not found at ${fixturePath}`);
  process.exit(1);
}
if (!existsSync(promptPath)) {
  console.error(`error: worker prompt not found at ${promptPath}`);
  process.exit(1);
}

const workerPrompt = readFileSync(promptPath, "utf8");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

// Force runId to a deterministic test value so output paths are predictable.
fixture.runId = `test-run-${fixtureName}`;

// Derive variantId(s) with the G5 formula media-production uses
// (sha256(scriptId|format|aspect)[:12]).
const { createHash } = await import("node:crypto");
const deriveVariantId = (aspect) =>
  createHash("sha256")
    .update(`${fixture.scriptId}|${fixture.format}|${aspect}`)
    .digest("hex")
    .slice(0, 12);

if (Array.isArray(fixture.aspects)) {
  // E-025 dual-aspect carousel: one worker, one variantId per aspect entry.
  for (const a of fixture.aspects) {
    if (!a.variantId) a.variantId = deriveVariantId(a.aspect);
  }
} else if (!fixture.variantId) {
  fixture.variantId = deriveVariantId(fixture.aspect);
}

const spawnPrompt = `${workerPrompt}

---

## Spawn-time inputs

\`\`\`json
${JSON.stringify(fixture, null, 2)}
\`\`\`

When done, respond with the JSON return shape from §6 of the worker prompt above. No surrounding prose.`;

const taskCall = `Task({
  subagent_type: "general-purpose",
  description: "Test render-worker (${fixtureName})",
  prompt: \`${spawnPrompt.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`
})`;

const outputDir = resolve(repoRoot, "tmp/test-output", fixtureName);
mkdirSync(outputDir, { recursive: true });
const promptOutPath = resolve(outputDir, "spawn-prompt.md");
const { writeFileSync } = await import("node:fs");
writeFileSync(promptOutPath, spawnPrompt);

console.log("");
console.log("=".repeat(72));
console.log(`STATIC-ASSET WORKER TEST HARNESS — fixture: ${fixtureName}`);
console.log("=".repeat(72));
console.log("");
console.log(`Spawn prompt written to:  tmp/test-output/${fixtureName}/spawn-prompt.md`);
if (Array.isArray(fixture.aspects)) {
  for (const a of fixture.aspects) {
    console.log(`Renders will land at:     data/assets/${fixture.runId}/${a.variantId}/<scene>.png  (${a.aspect})`);
  }
} else {
  console.log(`Renders will land at:     data/assets/${fixture.runId}/${fixture.variantId}/<scene>.png`);
}
console.log("");
console.log("To run the worker, paste the following Task() call into a Claude Code");
console.log("conversation that has access to: Task, Skill, Read, mcp__static-renderer__*");
console.log("");
console.log("─".repeat(72));
console.log(taskCall);
console.log("─".repeat(72));
console.log("");

if (flags.has("--copy")) {
  const result = spawnSync("pbcopy", { input: taskCall });
  if (result.status === 0) {
    console.log("✓ Task() call copied to clipboard");
  } else {
    console.warn("⚠ pbcopy unavailable — call printed above only");
  }
}

if (flags.has("--open")) {
  spawnSync("open", [outputDir]);
}
