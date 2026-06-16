import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Lang } from "../lib/types";
import { CopyMarkdownButton } from "./CopyMarkdownButton";

export type PerformanceReportRow = {
  decisionMemoEn?: string | null;
  decisionMemoBm?: string | null;
  selfCritique?: string | null;
  banditAllocation?: string | null;
} | null;

export function DecisionMemo({ row, lang }: { row: PerformanceReportRow; lang: Lang }) {
  if (!row) {
    return <div className="text-sm text-slate-500 italic">Decision Memo not yet produced for this run.</div>;
  }
  const body = (lang === "ms" ? row.decisionMemoBm : row.decisionMemoEn) ?? "";
  const allocation = row.banditAllocation?.trim();
  const critique = row.selfCritique?.trim();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold m-0">Decision Memo</h2>
        {body && <CopyMarkdownButton text={body} />}
      </div>
      {allocation && (
        <div className="text-xs flex gap-2 flex-wrap">
          {allocation.split(/[,·]/).map((a) => a.trim()).filter(Boolean).map((a) => (
            <span key={a} className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">{a}</span>
          ))}
        </div>
      )}
      <article className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "(no body)"}</ReactMarkdown>
      </article>
      {critique && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600 font-semibold">Self-critique</summary>
          <article className="prose prose-sm max-w-none mt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{critique}</ReactMarkdown>
          </article>
        </details>
      )}
    </div>
  );
}
