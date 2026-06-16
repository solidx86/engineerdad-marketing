import type { EntityLayout } from "../types.js";

export const hypothesesLayout: EntityLayout = {
  header: { title: "title", subtitle: "status", status: "status" },
  primary: [
    {
      title: "Statement",
      fields: [
        {
          role: "bilingual",
          en: "statementEn",
          bm: "statementBm",
          label: "Statement",
        },
      ],
    },
    {
      title: "Prediction",
      fields: [
        { role: "primary", field: "predictedEffect", label: "Predicted effect" },
        { role: "badge", field: "confidence" },
        { role: "list", field: "domain" },
        { role: "meta", field: "halfLifeDays", label: "Half-life (days)" },
        { role: "timestamp", field: "lastValidatedAt" },
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
      ],
    },
    {
      title: "Sources",
      fields: [{ role: "list", field: "sourceHypotheses" }],
    },
  ],
};
