#!/usr/bin/env node
// Re-pastes role-tagged fragment sections into .claude/agents/*.md files.
//
// Source of truth lives in packages/shared/src/prompts/<fragment>.md, with
// sections tagged via:
//   <!-- applies-to: roleA roleB --> ... <!-- /applies-to -->
//
// Agents inline their slice via:
//   <!-- include:<fragment>.md#<role> --> ... <!-- /include -->
//
// Run `pnpm sync:agents` after editing a fragment. Run with --check in CI /
// pre-commit to fail loud if any agent is out of sync.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const agentsDir = join(repoRoot, ".claude", "agents");
const fragmentsDir = join(repoRoot, "packages", "shared", "src", "prompts");

const INCLUDE_RE = /<!-- include:([^#\s]+)#([\w-]+) -->\n([\s\S]*?)<!-- \/include -->/g;
const APPLIES_RE = /<!-- applies-to:\s*([\w\s-]+?)\s*-->\n([\s\S]*?)<!-- \/applies-to -->/g;

function loadFragmentSection(fragmentPath, role) {
  const fullPath = join(fragmentsDir, fragmentPath);
  const source = readFileSync(fullPath, "utf8");
  const bodies = [];
  let m;
  APPLIES_RE.lastIndex = 0;
  while ((m = APPLIES_RE.exec(source)) !== null) {
    const roles = m[1].trim().split(/\s+/);
    if (roles.includes(role)) bodies.push(m[2]);
  }
  if (bodies.length === 0) {
    throw new Error(`no applies-to blocks for role "${role}" in ${fragmentPath}`);
  }
  return bodies.join("").trimEnd();
}

function syncFile(agentPath) {
  const original = readFileSync(agentPath, "utf8");
  let changed = false;
  const updated = original.replace(INCLUDE_RE, (full, fragmentPath, role, currentBody) => {
    const newBody = loadFragmentSection(fragmentPath, role);
    if (currentBody.trimEnd() === newBody) return full;
    changed = true;
    return `<!-- include:${fragmentPath}#${role} -->\n${newBody}\n<!-- /include -->`;
  });
  if (changed) writeFileSync(agentPath, updated);
  return changed;
}

const checkMode = process.argv.includes("--check");

const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
let updatedCount = 0;
for (const f of agentFiles) {
  const agentPath = join(agentsDir, f);
  if (syncFile(agentPath)) {
    if (checkMode) console.error(`  ✗ ${f} is out of sync`);
    else console.log(`  ✓ updated ${f}`);
    updatedCount++;
  }
}

if (checkMode && updatedCount > 0) {
  console.error(`\n${updatedCount} of ${agentFiles.length} agent files out of sync.`);
  console.error(`Run \`pnpm sync:agents\` to fix.`);
  process.exit(1);
}
console.log(`\n${updatedCount} of ${agentFiles.length} agent files updated.`);
