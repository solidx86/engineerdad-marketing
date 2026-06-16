import type { EntityLayout } from "../types.js";

export const briefsLayout: EntityLayout = {
  header: { title: "title", subtitle: "persona", status: "approvalStatus" },
  primary: [
    {
      title: "Brief",
      fields: [
        { role: "bilingual", en: "bodyEn", bm: "bodyBm", label: "Body" },
        { role: "meta", field: "angle" },
        { role: "meta", field: "promise" },
        { role: "meta", field: "funnelStage" },
      ],
    },
    {
      title: "Source",
      fields: [
        { role: "primary", field: "sourceInsights", label: "Insights" },
        { role: "list", field: "proofType", label: "Proof types" },
      ],
    },
  ],
  secondary: [
    {
      title: "Provenance",
      fields: [
        { role: "meta", field: "runId" },
        { role: "meta", field: "createdBy" },
        { role: "timestamp", field: "createdAt" },
        { role: "meta", field: "approver" },
      ],
    },
    {
      title: "Linked Hypotheses",
      fields: [{ role: "list", field: "linkedHypotheses" }],
    },
    {
      title: "Budget",
      fields: [{ role: "meta", field: "budgetBucket" }],
    },
  ],
};
