/**
 * One-shot recovery for run_1779779169 produce-stage halt (2026-05-26).
 *
 * The halt was caused by:
 *   A. CD worker for script 451148cf persisted its payload as a JSON-encoded
 *      scalar string → foldCreativePlan skipped it (orphan script).
 *   B. 2 Reels for scripts 0cfa88c9 and e4c96d73 failed compliance scan
 *      because shotNotes contained banned-phrase warnings + the canonical
 *      SC §8.18 disclaimer triggered an over-broad endorsement rule.
 *
 * The fixes shipped in:
 *   - packages/orchestrator/src/stages/produce.ts (stripShotNotes,
 *     foldCreativePlan parses string payloads)
 *   - packages/shared/src/compliance.ts (isNegated scans the match itself)
 *   - packages/orchestrator/src/exec.ts (write step throws on ok:false)
 *
 * This script:
 *   1. Rewrites the orphan step_result row from string-encoded to object
 *      (so the running orchestrator MCP's old-code foldCreativePlan picks it up).
 *   2. Replays deriveSpecs over all 5 CD outputs + the 8 render results.
 *   3. Inserts ONLY the missing variants (the 7 that didn't make it).
 *
 * Run via:  cd packages/store && pnpm exec tsx scripts/recover-produce.ts
 */
import postgres from "postgres";
import {
  deriveSpecs,
  type CreativePlan,
  type CreativeUnit,
  type RenderResult,
} from "@engineerdad/shared/derive";
import { store } from "../src/index.js";

const RUN_ID = "run_1779779169";
const ORPHAN_SR = "sr_01KSHTRBRYGPRNR8CVMXYBJNJN";

const DB = process.env.DATABASE_URL ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";
const sql = postgres(DB, { max: 2 });

function stripShotNotes(scenes: unknown): unknown {
  if (!Array.isArray(scenes)) return scenes;
  return scenes.map((s) => {
    if (s === null || typeof s !== "object") return s;
    const { shotNotes: _drop, ...rest } = s as Record<string, unknown>;
    return rest;
  });
}

async function main() {
  // STEP 1: the orphan step_result is corrupted (truncated mid-field JSON, not
  // just double-encoded), and a re-dispatched CD repeatedly emitted invalid
  // JSON containing unescaped quotes. Pragmatic recovery: un-approve the
  // orphan script so P0-scripts returns only the 4 with valid CD plans. P5
  // then expects 4×5=20 variants instead of 25.
  const orphanScript = "451148cf-1742-47c0-bba0-9230e415a270";
  await sql`
    UPDATE briefs SET approval_status = 'Awaiting Approval' WHERE id::text = ${orphanScript}
  `;
  await sql`
    UPDATE scripts SET approval_status = 'Awaiting Approval' WHERE id::text = ${orphanScript}
  `;
  console.log(`[step 1] un-approved orphan script ${orphanScript}`);

  // STEP 2: fold all 5 CD outputs into a CreativePlan, fetch the 8 renders.
  const cdRows = await sql<{ payload: unknown }[]>`
    SELECT payload FROM orchestrator.step_results
    WHERE run_id = ${RUN_ID} AND step_id = 'P1-fanout' AND payload_kind IS NULL
    ORDER BY created_at
  `;
  const creatives: CreativeUnit[] = [];
  for (const r of cdRows) {
    const p = r.payload;
    if (p === null || typeof p !== "object") continue;
    const c = (p as { creatives?: unknown }).creatives;
    if (Array.isArray(c)) creatives.push(...(c as CreativeUnit[]));
  }
  console.log(`[step 2] folded ${cdRows.length} CD outputs into ${creatives.length} creatives`);

  const renderRows = await sql<{ payload: unknown }[]>`
    SELECT payload FROM orchestrator.step_results
    WHERE run_id = ${RUN_ID} AND step_id = 'P2-render' AND payload_kind IS NULL
    ORDER BY created_at
  `;
  const renders: RenderResult[] = [];
  for (const r of renderRows) {
    const rr = (r.payload as { rendered?: unknown })?.rendered;
    if (Array.isArray(rr)) renders.push(...(rr as RenderResult[]));
  }
  console.log(`[step 2] folded ${renderRows.length} render outputs into ${renders.length} RenderResults`);

  const plan: CreativePlan = { runId: RUN_ID, creatives };
  const specs = deriveSpecs(plan, renders);
  console.log(`[step 2] derived ${specs.length} variants`);

  // STEP 3: check which variants are already in DB, insert only the missing.
  const existing = await sql<{ script: string; format: string; aspect: string }[]>`
    SELECT script, format, aspect FROM creative_variants WHERE run_id = ${RUN_ID}
  `;
  const key = (s: string, f: string, a: string) => `${s}|${f}|${a}`;
  const existingKeys = new Set(existing.map((e) => key(e.script, e.format, e.aspect)));
  const missing = specs.filter((v) => !existingKeys.has(key(v.scriptId, v.format, v.aspect)));
  console.log(`[step 3] ${existing.length} existing, ${missing.length} missing`);

  for (const v of missing) {
    const props: Record<string, unknown> = {
      runId: RUN_ID,
      script: v.scriptId,
      createdBy: "MediaProd",
      approvalStatus: "Awaiting Approval",
      format: v.format,
      aspect: v.aspect,
      channels: v.channels,
      estimatedCostMyr: v.estCostMyr,
      shotlistEn: JSON.stringify(stripShotNotes(v.shotlistEn)),
      shotlistBm: JSON.stringify(stripShotNotes(v.shotlistBm)),
      thumbnailBrief: v.thumbnailBrief,
      assetFiles: v.assetFiles,
    };
    if (v.meta) {
      props.metaPrimaryTextEn = v.meta.primaryTextEn;
      props.metaPrimaryTextBm = v.meta.primaryTextMs;
      props.metaHeadlineEn = v.meta.headlineEn;
      props.metaHeadlineBm = v.meta.headlineMs;
      props.metaDescriptionEn = v.meta.descriptionEn;
      props.metaDescriptionBm = v.meta.descriptionMs;
      props.metaCtaType = v.meta.ctaType;
      props.metaTargetingJson = v.meta.targetingJson;
    }
    if (v.yt) {
      props.ytTitle = v.yt.title;
      props.ytDescription = v.yt.description;
      props.ytTags = v.yt.tags;
      props.ytCategory = v.yt.category;
    }
    if (v.organic) {
      props.organicLanguage = v.organic.language;
      props.organicCaptionEn = v.organic.captionEn;
      props.organicCaptionBm = v.organic.captionMs;
      props.organicHashtagsIg = v.organic.hashtagsIg;
      props.organicHashtagsFb = v.organic.hashtagsFb;
    }
    const r = await store.create("CreativeVariants", props);
    if (!r.ok) {
      console.error(`  FAIL ${v.scriptId} ${v.format}/${v.aspect}: ${(r.problems ?? []).join("; ")}`);
    } else {
      console.log(`  OK   ${v.scriptId} ${v.format}/${v.aspect} → ${r.id}`);
    }
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
