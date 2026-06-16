export type MetaPaidMode = "api" | "manual";

/** Default `manual` until Meta business verification unblocks the API path. */
export function metaPaidMode(): MetaPaidMode {
  return process.env.META_PAID_MODE === "api" ? "api" : "manual";
}
