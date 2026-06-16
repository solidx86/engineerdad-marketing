"use client";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import type { Lang } from "../lib/types.js";

export function LanguageToggle({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  function set(next: Lang) {
    const sp = new URLSearchParams(params.toString());
    if (next === "en") sp.delete("lang"); else sp.set("lang", next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
  return (
    <div className="inline-flex rounded border border-slate-300 text-xs font-semibold overflow-hidden">
      <button onClick={() => set("en")} aria-pressed={lang === "en"}
              className={`px-2 py-1 ${lang === "en" ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>EN</button>
      <button onClick={() => set("ms")} aria-pressed={lang === "ms"}
              className={`px-2 py-1 border-l border-slate-300 ${lang === "ms" ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>BM</button>
    </div>
  );
}

export { langFromSearchParams } from "../lib/lang";
