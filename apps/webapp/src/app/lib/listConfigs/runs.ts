import type { ListConfig } from "../types.js";

export const RUN_STAGES = [
  "fixture",
  "tracking",
  "analytics",
  "synthesize",
  "brief",
  "content",
  "produce",
  "schedule",
  "experiment",
  "distribute",
  "done",
] as const;

export const RUN_STATUS = ["active", "awaiting_gate", "blocked", "done"] as const;

export const runsList: ListConfig = {
  columns: [
    { field: "runId", label: "runId", type: "text" },
    { field: "createdAt", label: "Started", type: "timestamp" },
    { field: "stage", label: "Stage", type: "badge" },
    { field: "status", label: "State", type: "status" },
  ],
  filters: [
    { field: "stage", label: "Stage", type: "select", options: RUN_STAGES },
    { field: "status", label: "State", type: "select", options: RUN_STATUS },
  ],
};
