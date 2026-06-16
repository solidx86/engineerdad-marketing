import "server-only";
import { store } from "@engineerdad/store";
import { renderPostingPack, type PostingPackSpec } from "@engineerdad/distribute";
import type { DistVariant, AllocatedCell } from "@engineerdad/orchestrator";

const VARIANT_FIELDS = [
  "title", "format", "aspect", "channels", "assetFiles", "adId",
  "metaPrimaryTextEn", "metaPrimaryTextBm", "metaHeadlineEn", "metaHeadlineBm",
  "metaDescriptionEn", "metaDescriptionBm", "metaCtaType",
];

function cellsOf(expRow: unknown): AllocatedCell[] {
  if (!expRow || typeof expRow !== "object") return [];
  const raw = (expRow as { cells?: unknown }).cells;
  if (Array.isArray(raw)) return raw as AllocatedCell[];
  if (typeof raw === "string") { try { return JSON.parse(raw) as AllocatedCell[]; } catch { return []; } }
  return [];
}

export async function getMetaPostingPack(runId: string, dailyBudgetMyr = 0): Promise<PostingPackSpec> {
  const ids = await store.query("CreativeVariants", { runId, approvalStatus: "Approved" }, { fields: VARIANT_FIELDS });
  const rows = (await Promise.all(ids.map((r) => store.get("CreativeVariants", r.id as string)))).filter(Boolean) as Record<string, unknown>[];
  const exps = await store.query("Experiments", { runId }, { fields: ["cells"] });
  const expFull = exps[0] ? await store.get("Experiments", exps[0].id as string) : null;
  const cells = cellsOf(expFull);
  const s = (row: Record<string, unknown>, k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  const variants: DistVariant[] = rows.map((row) => {
    const vid = s(row, "id");
    const hit = cells.find((c) => c.variantPageIds.includes(vid));
    return {
      rowId: vid, variantId: vid, format: s(row, "format"), aspect: s(row, "aspect"),
      channels: Array.isArray(row.channels) ? (row.channels as string[]) : [],
      assetFiles: Array.isArray(row.assetFiles) ? (row.assetFiles as { url: string }[]) : [],
      adId: row.adId ?? null, ytVideoId: null, cellId: hit ? hit.cellId : null,
      metaSpec: (s(row, "metaPrimaryTextEn") || s(row, "metaHeadlineEn"))
        ? {
            primaryTextEn: s(row, "metaPrimaryTextEn"), primaryTextMs: s(row, "metaPrimaryTextBm"),
            headlineEn: s(row, "metaHeadlineEn"), headlineMs: s(row, "metaHeadlineBm"),
            descriptionEn: s(row, "metaDescriptionEn"), descriptionMs: s(row, "metaDescriptionBm"),
            ctaType: s(row, "metaCtaType"), targetingJson: "",
          }
        : null,
      ytSpec: null, fbPostId: null, organicScheduledFor: null, organicCaption: null, organicLang: null,
      ...({ title: s(row, "title") } as object),
    } as DistVariant;
  });
  return renderPostingPack(runId, variants, cells, dailyBudgetMyr);
}
