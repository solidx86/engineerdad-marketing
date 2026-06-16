import type { ListConfig } from "../types.js";
import { DISTRIBUTION_CHANNEL, DISTRIBUTION_STATUS, DISTRIBUTION_AUTHOR_STEP } from "@engineerdad/store";

export const distributionsList: ListConfig = {
  columns: [
    { field: "createdAt", label: "When", type: "timestamp", sortable: true },
    { field: "channel", label: "Channel", type: "badge" },
    { field: "targetEntity", label: "Target", type: "badge" },
    { field: "targetId", label: "Target ID", type: "text", width: "narrow" },
    { field: "status", label: "Status", type: "status" },
    { field: "authorStep", label: "Step", type: "badge" },
    { field: "attempt", label: "Try", type: "text", width: "narrow" },
    { field: "runId", label: "Run", type: "runId" },
  ],
  defaultSort: { field: "createdAt", dir: "desc" as const },
  filters: [
    { field: "channel", label: "Channel", type: "select", options: DISTRIBUTION_CHANNEL },
    { field: "status", label: "Status", type: "select", options: DISTRIBUTION_STATUS },
    { field: "authorStep", label: "Step", type: "select", options: DISTRIBUTION_AUTHOR_STEP },
  ],
};
