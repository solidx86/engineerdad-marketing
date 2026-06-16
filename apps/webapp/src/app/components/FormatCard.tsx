"use client";
import { useState } from "react";
import Link from "next/link";
import { AllScenesViewer } from "./AllScenesViewer";

type Variant = {
  id: string;
  format: string;
  aspect: "4:5" | "1:1" | "9:16" | "16:9";
  assetFiles?: { url: string }[] | null;
  approvalStatus?: string;
  organicStatus?: string;
};

export function FormatCard({ format, variants }: { format: string; variants: Variant[] }) {
  const aspects = [...new Set(variants.map((v) => v.aspect))];
  const [active, setActive] = useState<string>(aspects[0]);
  const variant = variants.find((v) => v.aspect === active);
  return (
    <div className="border border-slate-200 rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm m-0">{format}</h4>
        {aspects.length > 1 && (
          <div className="inline-flex border border-slate-300 rounded overflow-hidden text-xs font-semibold">
            {aspects.map((a) => (
              <button key={a} onClick={() => setActive(a)}
                      className={`px-2 py-0.5 ${a === active ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>
                {a}
              </button>
            ))}
          </div>
        )}
      </div>
      {variant && (
        <>
          <AllScenesViewer assets={variant.assetFiles ?? []} aspect={variant.aspect} />
          <div className="mt-3 text-xs flex gap-3 flex-wrap">
            <span>Approval: <b>{variant.approvalStatus ?? "—"}</b></span>
            <span>Organic: <b>{variant.organicStatus ?? "—"}</b></span>
            <Link href={`/review/creative-variants/${variant.id}`} className="text-indigo-600 hover:underline ml-auto">Edit →</Link>
          </div>
        </>
      )}
    </div>
  );
}
