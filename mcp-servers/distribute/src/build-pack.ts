import { store } from "@engineerdad/store";
import { renderPostingPack } from "@engineerdad/distribute";
import type { PostingPackSpec } from "@engineerdad/distribute";
import type { DistVariant, AllocatedCell } from "@engineerdad/orchestrator";

const VARIANT_FIELDS = [
  "title", "format", "aspect", "channels", "assetFiles", "adId",
  "metaPrimaryTextEn", "metaPrimaryTextBm", "metaHeadlineEn", "metaHeadlineBm",
  "metaDescriptionEn", "metaDescriptionBm", "metaCtaType",
];

function projectVariant(row: Record<string, unknown>): DistVariant {
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  return {
    rowId: s("id"), variantId: s("id"), format: s("format"), aspect: s("aspect"),
    channels: Array.isArray(row.channels) ? (row.channels as string[]) : [],
    assetFiles: Array.isArray(row.assetFiles) ? (row.assetFiles as { url: string }[]) : [],
    adId: row.adId ?? null, ytVideoId: null,
    metaSpec: (s("metaPrimaryTextEn") || s("metaHeadlineEn"))
      ? {
          primaryTextEn: s("metaPrimaryTextEn"), primaryTextMs: s("metaPrimaryTextBm"),
          headlineEn: s("metaHeadlineEn"), headlineMs: s("metaHeadlineBm"),
          descriptionEn: s("metaDescriptionEn"), descriptionMs: s("metaDescriptionBm"),
          ctaType: s("metaCtaType"), targetingJson: "",
        }
      : null,
    ytSpec: null, cellId: null, fbPostId: null,
    organicScheduledFor: null, organicCaption: null, organicLang: null,
    ...({ title: s("title") } as object),
  } as DistVariant;
}

function cellsOf(expRow: unknown): AllocatedCell[] {
  if (!expRow || typeof expRow !== "object") return [];
  const raw = (expRow as { cells?: unknown }).cells;
  if (Array.isArray(raw)) return raw as AllocatedCell[];
  if (typeof raw === "string") { try { return JSON.parse(raw) as AllocatedCell[]; } catch { return []; } }
  return [];
}

export async function buildPostingPack(runId: string, dailyBudgetMyr: number): Promise<PostingPackSpec> {
  const variantRows = await store.query("CreativeVariants", { runId, approvalStatus: "Approved" }, { fields: VARIANT_FIELDS });
  const full = await Promise.all(variantRows.map((r) => store.get("CreativeVariants", r.id as string)));
  const exps = await store.query("Experiments", { runId }, { fields: ["cells"] });
  const expFull = exps[0] ? await store.get("Experiments", exps[0].id as string) : null;
  const cells = cellsOf(expFull);
  // attach cellId via the experiment's variantPageIds
  const variants = full.filter(Boolean).map((row) => {
    const v = projectVariant(row as Record<string, unknown>);
    const hit = cells.find((c) => c.variantPageIds.includes(v.variantId));
    return { ...v, cellId: hit ? hit.cellId : null } as DistVariant;
  });
  return renderPostingPack(runId, variants, cells, dailyBudgetMyr);
}

export async function backfillAdId(rowId: string, adIdEn: string | null, adIdMs: string | null) {
  const r = await store.update("CreativeVariants", rowId, { adId: JSON.stringify({ en: adIdEn, ms: adIdMs }) });
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "backfill failed");
  return { ok: true, rowId };
}
