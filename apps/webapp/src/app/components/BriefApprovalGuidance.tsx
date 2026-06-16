// Server component — at HG1, previews the tri-state experiment outcome an
// operator would get if they approved the current Brief set as-is. Groups
// Briefs by angle, classifies via the shared classifyExperimentStatus helper
// (single source of truth shared with verify-experiment), and surfaces a
// colour-coded verdict + per-angle coverage. Server-recomputes on every
// approval (Option A — consistent with existing approve-flow revalidation).
//
// Spec §3.4.3. Plan Task 23.
import "server-only";
import { classifyExperimentStatus, type ExperimentStatus } from "@engineerdad/shared";
import { store } from "@engineerdad/store";

interface AngleCoverage {
  angle: string;
  approved: number;
  total: number;
}

export async function BriefApprovalGuidance({ runId }: { runId: string }) {
  if (!runId) return null;

  const briefs = await store.query(
    "Briefs",
    { runId } as Parameters<typeof store.query>[1],
    { fields: ["angle", "approvalStatus"] },
  );

  if (briefs.length === 0) return null;

  const byAngle = new Map<string, { approved: number; total: number }>();
  for (const b of briefs) {
    const row = b as Record<string, unknown>;
    const angle = String(row.angle ?? "");
    const status = String(row.approvalStatus ?? "");
    if (!byAngle.has(angle)) byAngle.set(angle, { approved: 0, total: 0 });
    const slot = byAngle.get(angle)!;
    slot.total += 1;
    if (status === "Approved") slot.approved += 1;
  }

  const coverage: AngleCoverage[] = [...byAngle.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([angle, { approved, total }]) => ({ angle, approved, total }));

  if (coverage.length === 0) return null;

  const occupied = coverage.filter((c) => c.approved > 0).length;
  const status: ExperimentStatus = classifyExperimentStatus({
    occupied,
    total: coverage.length,
  });

  const verdict: Record<ExperimentStatus, string> = {
    full: "Approving as-is will produce a FULL experiment (all angle cells populated).",
    degraded: "Approving as-is will produce a DEGRADED experiment (≥2 cells populated, ≥1 empty).",
    "single-cell":
      "Approving as-is will produce a SINGLE-CELL result (routing, not experiment — no A/B comparison).",
    broken:
      "WARNING: no angles have approved Briefs yet. Distribute will halt at verify-experiment.",
  };

  const bg =
    status === "broken"
      ? "#ffeded"
      : status === "single-cell"
        ? "#fff8dc"
        : status === "degraded"
          ? "#fff8dc"
          : "#f0f7ed";

  return (
    <div
      style={{
        background: bg,
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "10px 14px",
        margin: "12px 0",
        fontSize: 13,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{verdict[status]}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {coverage.map((c) => (
          <li key={c.angle} style={{ fontFamily: "monospace" }}>
            {c.angle} · {c.approved} of {c.total} approved
            {c.approved === 0 && <span style={{ color: "#c04040" }}> ← empty cell</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
