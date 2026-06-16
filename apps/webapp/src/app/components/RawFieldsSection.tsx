export function RawFieldsSection({ row, usedFields }: { row: Record<string, unknown>; usedFields: Set<string> }) {
  const skip = new Set(["createdAt", "updatedAt", "complianceCheck"]);
  const rawKeys = Object.keys(row).filter((k) => !usedFields.has(k) && !skip.has(k));
  if (rawKeys.length === 0) return null;
  return (
    <details className="mt-6 border-t border-slate-200 pt-3 text-xs">
      <summary className="cursor-pointer text-slate-500">Raw fields ({rawKeys.length})</summary>
      <dl className="grid grid-cols-[max-content_1fr] gap-1 mt-2 font-mono">
        {rawKeys.map((k) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-all">{typeof row[k] === "object" ? JSON.stringify(row[k]) : String(row[k] ?? "—")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
