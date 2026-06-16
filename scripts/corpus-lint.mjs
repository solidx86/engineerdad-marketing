#!/usr/bin/env node
// corpus-lint — grounding gate for objection-cluster (d-*) entries.
// Partially delivers TASKS.md E-026, scoped to what the objection-corpus plan needs.
//
// Checks (per docs/superpowers/plans/2026-06-07-ut-objection-corpus.md Task 14b):
//   1. Slug resolution     — every related: slug resolves to a real corpus file (FAIL)
//   2. source_ref paths     — every corpus/... path inside source_ref exists (FAIL)
//   3. Frontmatter          — d-entries carry cluster: objection, valid funnel_tier,
//                             verified_at, lang_status (FAIL)
//   4. Compliance framing   — first non-heading line after the H1 is a > blockquote (FAIL)
//   5. Figure drift         — every RM>=1000 in a d-entry body appears (digits-only) in an
//                             artifact named in related:/source_ref (WARN)
//
// Usage: node scripts/corpus-lint.mjs            (lint all corpus/knowledge/*.md)
//        node scripts/corpus-lint.mjs d0 d1 d2   (limit to filename prefixes)
// Exit 1 on any FAIL; WARNs never fail the build.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KNOWLEDGE = join(ROOT, "corpus/knowledge");
const VALID_TIERS = new Set(["necessity", "avoidance", "substitution"]);

const prefixes = process.argv.slice(2);
const fails = [];
const warns = [];

// Resolve a related: slug to a real file in any of the four corpus locations.
function slugResolves(slug) {
  return [
    `corpus/knowledge/${slug}.md`,
    `corpus/proof/${slug}.md`,
    `corpus/data/datasets/${slug}.json`,
    `corpus/data/charts/${slug}.yaml`,
  ].some((p) => existsSync(join(ROOT, p)));
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim();
  }
  return { fm, raw: m[1], body: text.slice(m[0].length) };
}

const files = readdirSync(KNOWLEDGE)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => prefixes.length === 0 || prefixes.some((p) => f.startsWith(p)));

for (const file of files) {
  const path = `corpus/knowledge/${file}`;
  const text = readFileSync(join(KNOWLEDGE, file), "utf8");
  const isDEntry = /^d\d/.test(file);
  // d-entries are hard-gated; everything else is checked tolerantly (WARN), so a
  // pre-existing non-d file with no frontmatter or a stale ref never fails the build.
  const sink = isDEntry ? fails : warns;
  const parsed = parseFrontmatter(text);
  if (!parsed) {
    if (isDEntry) fails.push(`${path}: no YAML frontmatter`);
    continue; // non-d file without frontmatter — nothing to check
  }
  const { fm, raw, body } = parsed;

  // --- Check 1: related: slug resolution ---
  const relMatch = raw.match(/related:\s*\[([^\]]*)\]/);
  if (relMatch) {
    for (const slug of relMatch[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!slugResolves(slug)) sink.push(`${path}: related slug "${slug}" resolves to no corpus file`);
    }
  }

  // --- Check 2: source_ref corpus/... paths exist ---
  // source_ref may span lines; pull it from the raw frontmatter block.
  const srMatch = raw.match(/source_ref:\s*"([\s\S]*?)"/);
  if (srMatch) {
    const paths = srMatch[1].match(/corpus\/[\w./-]+\.(md|json|yaml)/g) || [];
    for (const p of [...new Set(paths)]) {
      if (!existsSync(join(ROOT, p))) sink.push(`${path}: source_ref path "${p}" does not exist`);
    }
  }

  if (!isDEntry) continue; // checks 3-5 are d-entry-specific

  // --- Check 3: frontmatter completeness ---
  if (fm.cluster !== "objection") fails.push(`${path}: cluster must be "objection" (got "${fm.cluster ?? "—"}")`);
  if (!VALID_TIERS.has(fm.funnel_tier)) fails.push(`${path}: funnel_tier invalid (got "${fm.funnel_tier ?? "—"}")`);
  if (!fm.verified_at) fails.push(`${path}: missing verified_at`);
  if (!fm.lang_status) fails.push(`${path}: missing lang_status`);

  // --- Check 4: compliance framing blockquote after H1 ---
  const lines = body.split("\n");
  let seenH1 = false, framingOk = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!seenH1) { if (t.startsWith("# ")) seenH1 = true; continue; }
    framingOk = t.startsWith(">");
    break; // first non-empty line after H1
  }
  if (!framingOk) fails.push(`${path}: first line after H1 must be a ">" compliance-framing blockquote`);

  // --- Check 5: figure drift (WARN) ---
  const artifacts = new Set();
  if (relMatch) relMatch[1].split(",").forEach((s) => artifacts.add(s.trim()));
  // also any slugs named inside source_ref paths
  (srMatch?.[1].match(/corpus\/[\w./-]+\.(md|json|yaml)/g) || []).forEach((p) =>
    artifacts.add(p.split("/").pop().replace(/\.(md|json|yaml)$/, "")),
  );
  const artifactDigits = [...artifacts]
    .map((slug) => {
      for (const p of [`corpus/knowledge/${slug}.md`, `corpus/proof/${slug}.md`, `corpus/data/${slug}.json`, `corpus/data/charts/${slug}.yaml`]) {
        if (existsSync(join(ROOT, p))) return readFileSync(join(ROOT, p), "utf8").replace(/[,\s]/g, "");
      }
      return "";
    })
    .join("|");
  const rmFigures = [...body.matchAll(/RM\s?([\d,]{4,})/g)].map((m) => m[1].replace(/,/g, ""));
  for (const digits of [...new Set(rmFigures)]) {
    if (Number(digits) >= 1000 && !artifactDigits.includes(digits)) {
      warns.push(`${path}: RM${digits} not found in any related/source_ref artifact (derived figure? verify by hand)`);
    }
  }
}

for (const w of warns) console.log(`WARN  ${w}`);
for (const f of fails) console.log(`FAIL  ${f}`);
console.log(`\ncorpus-lint: ${files.length} file(s) checked, ${fails.length} FAIL, ${warns.length} WARN`);
process.exit(fails.length > 0 ? 1 : 0);
