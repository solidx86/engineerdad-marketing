"use server";
import { store, type EntityName } from "@engineerdad/store";
import { revalidatePath } from "next/cache";
import { slugOf } from "./entities";

export async function saveRow(entity: EntityName, id: string, formData: FormData) {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k === "_status") continue;
    patch[k] = typeof v === "string" ? v : String(v);
  }
  const r = await store.update(entity, id, patch);
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "update failed");
  const status = formData.get("_status");
  if (typeof status === "string" && status.length > 0) {
    await store.setStatus(entity, id, status);
  }
  revalidatePath(`/${slugOf(entity)}`);
  revalidatePath(`/${slugOf(entity)}/${id}`);
}

export async function setStatus(entity: EntityName, id: string, status: string, _formData?: FormData) {
  const r = await store.setStatus(entity, id, status);
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "setStatus failed");
  revalidatePath(`/review/${slugOf(entity)}`);
  revalidatePath(`/review/${slugOf(entity)}/${id}`);
}

/** Record the Meta ad IDs (EN/BM) the operator created by hand in Ads Manager. */
export async function backfillAdId(rowId: string, formData: FormData) {
  const adIdEn = (formData.get("adIdEn") as string | null)?.trim() || null;
  const adIdMs = (formData.get("adIdMs") as string | null)?.trim() || null;
  const r = await store.update("CreativeVariants", rowId, { adId: JSON.stringify({ en: adIdEn, ms: adIdMs }) });
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "backfill failed");
  const runId = formData.get("runId") as string;
  revalidatePath(`/posting-pack/${runId}`);
}

/** Mark an IG organic post as published by recording its post ID. */
export async function backfillIgPostId(rowId: string, formData: FormData) {
  const igPostId = (formData.get("igPostId") as string | null)?.trim();
  if (!igPostId) throw new Error("igPostId required");
  const r = await store.update("CreativeVariants", rowId, { igPostId });
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "backfill failed");
  const runId = formData.get("runId") as string;
  revalidatePath(`/posting-pack/organic/${runId}`);
}
