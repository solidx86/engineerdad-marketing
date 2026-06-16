// Scratch diagnostic: replay scanProps over the persisted CD outputs to
// identify which fields trigger compliance violations for the missing Reels.
import postgres from "postgres";
import { deriveSpecs, type CreativePlan, type CreativeUnit } from "@engineerdad/shared/derive";
import { scanProps } from "../src/compliance.js";

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
  const rows = await sql<{ id: string; payload: unknown }[]>`
    SELECT id, payload FROM orchestrator.step_results
    WHERE step_id='P1-fanout' AND payload_kind IS NULL
    ORDER BY created_at
  `;

  const creatives: CreativeUnit[] = [];
  for (const r of rows) {
    if (typeof r.payload === "string") {
      console.log(`Skipping ${r.id} — payload stored as scalar string`);
      continue;
    }
    const cc = (r.payload as { creatives?: unknown }).creatives;
    if (Array.isArray(cc)) creatives.push(...(cc as CreativeUnit[]));
  }
  console.log(`Total creatives folded: ${creatives.length}`);

  const plan: CreativePlan = { runId: "run_1779779169", creatives };
  const specs = deriveSpecs(plan, []);
  console.log(`Total derived variants: ${specs.length}`);

  // Mirror variantProperties from packages/orchestrator/src/stages/produce.ts
  const variantProps = (v: typeof specs[number]) => {
    const props: Record<string, unknown> = {
      runId: "run_1779779169",
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
    return props;
  };

  let failures = 0;
  for (const v of specs) {
    const props = variantProps(v);
    const r = await scanProps("CreativeVariants" as never, props);
    if (!r.ok) {
      failures++;
      console.log(`\n--- FAILED: script=${v.scriptId} format=${v.format} aspect=${v.aspect}`);
      for (const p of r.problems ?? []) console.log(`  ${p}`);
    }
  }
  console.log(`\nTotal failures: ${failures}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
