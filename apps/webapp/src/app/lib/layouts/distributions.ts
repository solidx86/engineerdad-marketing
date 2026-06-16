import type { EntityLayout } from "../types.js";

// Distributions is an append-only event log — the list view at
// /review/distributions is the primary surface. The detail route at
// /review/distributions/[id] just shows the raw row contents in a tidy
// shape; no bilingual content, no decisions to surface.
export const distributionsLayout: EntityLayout = {
  header: { title: "title", subtitle: "channel", status: "status" },
  primary: [
    {
      title: "Outcome",
      fields: [
        { role: "badge", field: "channel" },
        { role: "badge", field: "targetEntity" },
        { role: "link", field: "targetId", label: "Target ID" },
        { role: "status", field: "status" },
        { role: "badge", field: "authorStep", label: "Authored by" },
        { role: "meta", field: "tool", label: "Tool" },
      ],
    },
    {
      title: "Detail",
      fields: [
        { role: "primary", field: "outputJson", label: "Output" },
        { role: "primary", field: "errorMessage", label: "Error" },
        { role: "primary", field: "skipReason", label: "Skip reason" },
      ],
    },
  ],
  secondary: [
    {
      title: "Provenance",
      fields: [
        { role: "meta", field: "runId" },
        { role: "meta", field: "attempt" },
        { role: "meta", field: "dryRun", label: "Dry run" },
        { role: "timestamp", field: "attemptedAt", label: "Attempted at" },
        { role: "timestamp", field: "completedAt", label: "Completed at" },
        { role: "timestamp", field: "createdAt" },
      ],
    },
  ],
};
