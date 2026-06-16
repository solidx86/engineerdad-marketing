"use client";
import Link from "next/link";
import { useState, useEffect } from "react";

const REVIEW_ENTITIES: { slug: string; label: string }[] = [
  { slug: "briefs", label: "Briefs" },
  { slug: "scripts", label: "Scripts" },
  { slug: "authority-articles", label: "Authority Articles" },
  { slug: "creative-variants", label: "Creative Variants" },
  { slug: "experiments", label: "Experiments" },
  { slug: "performance-reports", label: "Memos & Performance" },
  { slug: "hypotheses", label: "Hypotheses" },
  { slug: "learnings", label: "Learnings" },
];

function useCollapse(key: string, initial: boolean) {
  const [collapsed, setCollapsed] = useState(initial);
  useEffect(() => {
    const v = localStorage.getItem(`nav.${key}`);
    if (v != null) setCollapsed(v === "1");
  }, [key]);
  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(`nav.${key}`, next ? "1" : "0");
      return next;
    });
  }
  return [collapsed, toggle] as const;
}

export function LeftNav() {
  const [runsCollapsed, toggleRuns] = useCollapse("runs", false);
  const [reviewCollapsed, toggleReview] = useCollapse("review", false);
  return (
    <nav className="w-60 border-r border-slate-200 p-4 bg-white min-h-screen text-sm">
      <Link href="/" className="block font-bold mb-4">EngineerDad</Link>
      <Link href="/" className="block py-1 px-2 rounded hover:bg-slate-100 mb-1">Dashboard</Link>
      <button onClick={toggleRuns} className="w-full text-left py-1 px-2 font-semibold flex items-center gap-1">
        <span>{runsCollapsed ? "▸" : "▾"}</span> Runs
      </button>
      {!runsCollapsed && (
        <ul className="ml-4 mb-2">
          <li><Link href="/runs" className="block py-1 px-2 rounded hover:bg-slate-100">All runs</Link></li>
        </ul>
      )}
      <button onClick={toggleReview} className="w-full text-left py-1 px-2 font-semibold flex items-center gap-1">
        <span>{reviewCollapsed ? "▸" : "▾"}</span> Marketing Review
      </button>
      {!reviewCollapsed && (
        <ul className="ml-4">
          {REVIEW_ENTITIES.map((e) => (
            <li key={e.slug}><Link href={`/review/${e.slug}`} className="block py-1 px-2 rounded hover:bg-slate-100">{e.label}</Link></li>
          ))}
        </ul>
      )}
    </nav>
  );
}
