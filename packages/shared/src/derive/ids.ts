import { createHash } from "node:crypto";
import type { ScriptFormat, Aspect } from "../types.js";

/** Deterministic 12-hex-char Variant id from its identity tuple (was media-production G5). */
export function variantId(
  scriptId: string,
  format: ScriptFormat,
  aspect: Aspect,
): string {
  return createHash("sha256")
    .update(`${scriptId}|${format}|${aspect}`)
    .digest("hex")
    .slice(0, 12);
}
