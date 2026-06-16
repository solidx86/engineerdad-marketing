import {
  CAMPAIGN_OBJECTIVE,
  dailyBudgetCentsFor,
  targetingForCell,
  type DistVariant,
  type AllocatedCell,
} from "@engineerdad/orchestrator";
import type { PostingPackSpec, PostingPackAdset, PostingPackAd } from "./types.js";

const META = "Meta-paid";

/** Parse the text adId column into {en, ms}. Tolerates JSON object/string/bare. */
function parseAdId(raw: unknown): { en: string | null; ms: string | null } {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return { en: typeof o.en === "string" ? o.en : null, ms: typeof o.ms === "string" ? o.ms : null };
  }
  if (typeof raw === "string" && raw.length > 0) {
    try { return parseAdId(JSON.parse(raw)); } catch { return { en: raw, ms: null }; }
  }
  return { en: null, ms: null };
}

/** Routable = Meta-paid, has metaSpec, has a cell present in the design. */
function isRoutable(v: DistVariant, cellIds: Set<string>): boolean {
  return v.channels.includes(META) && !!v.metaSpec && !!v.cellId && cellIds.has(v.cellId);
}

export function renderPostingPack(
  runId: string,
  variants: DistVariant[],
  cells: AllocatedCell[],
  dailyBudgetMyr: number,
): PostingPackSpec {
  const cellById = new Map(cells.map((c) => [c.cellId, c]));
  const cellIds = new Set(cells.map((c) => c.cellId));
  const routable = variants.filter((v) => isRoutable(v, cellIds));

  const adsetByCell = new Map<string, PostingPackAdset>();
  const ads: PostingPackAd[] = [];

  for (const v of routable) {
    const cell = cellById.get(v.cellId!)!;
    const adsetName = `${runId}__${cell.cellId}`;
    if (!adsetByCell.has(cell.cellId)) {
      const t = targetingForCell(cell);
      const cents = dailyBudgetCentsFor(cell, dailyBudgetMyr);
      adsetByCell.set(cell.cellId, {
        cellId: cell.cellId,
        name: adsetName,
        dailyBudgetCents: cents,
        dailyBudgetMyr: cents / 100,
        optimizationGoal: "LEAD_GENERATION",
        billingEvent: "IMPRESSIONS",
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: {
          countries: t.geo_locations.countries,
          ageMin: t.age_min,
          ageMax: t.age_max,
          locales: t.locales,
        },
      });
    }
    const s = v.metaSpec!;
    const bf = parseAdId(v.adId);
    ads.push({
      variantId: v.variantId,
      rowId: v.rowId,
      title: (v as unknown as { title?: string }).title ?? v.variantId,
      cellId: cell.cellId,
      adsetName,
      asset: { urls: v.assetFiles.map((f) => f.url), format: v.format, aspect: v.aspect ?? null },
      en: { primaryText: s.primaryTextEn, headline: s.headlineEn, description: s.descriptionEn },
      bm: { primaryText: s.primaryTextMs, headline: s.headlineMs, description: s.descriptionMs },
      ctaType: s.ctaType,
      backfill: { adIdEn: bf.en, adIdMs: bf.ms, done: !!(bf.en && bf.ms) },
    });
  }

  return {
    runId,
    campaign: { name: `EDOS_${runId}`, objective: CAMPAIGN_OBJECTIVE, specialAdCategories: [] },
    adsets: [...adsetByCell.values()],
    ads,
  };
}
