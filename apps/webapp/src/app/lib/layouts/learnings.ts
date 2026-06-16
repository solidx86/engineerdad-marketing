import type { EntityLayout } from "../types.js";

export const learningsLayout: EntityLayout = {
  header: { title: "title", subtitle: "status", status: "status" },
  primary: [
    {
      title: "Statement",
      fields: [
        { role: "bilingual", en: "statementEn", bm: "statementBm", label: "Statement" },
      ],
    },
    {
      title: "Evidence",
      fields: [
        { role: "badge", field: "confidence" },
        { role: "meta", field: "halfLifeDays", label: "Half-life (days)" },
        { role: "timestamp", field: "lastValidatedAt" },
        { role: "list", field: "domain" },
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
