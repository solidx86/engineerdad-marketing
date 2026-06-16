import type { Lang } from "./types";

export function langFromSearchParams(sp: { lang?: string } | undefined): Lang {
  return sp?.lang === "ms" ? "ms" : "en";
}
