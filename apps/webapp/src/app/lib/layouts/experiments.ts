import type { EntityLayout } from "../types.js";

export const experimentsLayout: EntityLayout = {
  header: {
    title: "title",
    subtitle: "testType",
    status: "status",
    secondaryStatus: "approvalStatus",
  },
  primary: [
    {
      title: "Hypothesis",
      fields: [
        { role: "fk", field: "hypothesis", fk: "Hypotheses", label: "Hypothesis" },
      ],
    },
    {
      title: "Design",
      fields: [
        { role: "primary", field: "factors", label: "Factors" },
        { role: "primary", field: "cells", label: "Cells" },
        { role: "badge", field: "primaryMetric" },
        { role: "badge", field: "testType" },
        { role: "meta", field: "launchWindow" },
        { role: "meta", field: "dailyBudgetMyr", label: "Daily budget (MYR)" },
        { role: "meta", field: "durationDays", label: "Duration (days)" },
      ],
    },
    {
      title: "Readout",
      fields: [{ role: "primary", field: "readout" }],
    },
  ],
  secondary: [
    {
      title: "Provenance",
      fields: [
        { role: "meta", field: "runId" },
        { role: "timestamp", field: "createdAt" },
        { role: "meta", field: "approver" },
      ],
    },
    {
      title: "Linked Variants",
      fields: [{ role: "list", field: "linkedVariants" }],
    },
  ],
};
