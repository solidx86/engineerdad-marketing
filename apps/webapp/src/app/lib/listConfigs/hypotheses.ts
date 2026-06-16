import type { ListConfig } from "../types.js";
import { DOMAIN, HYPOTHESIS_STATUS, LEARNING_CONFIDENCE } from "@engineerdad/store";

export const hypothesesList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text" },
    { field: "status", label: "Status", type: "status" },
    { field: "confidence", label: "Confidence", type: "badge" },
    { field: "domain", label: "Domain", type: "chips" },
    { field: "runId", label: "Run", type: "runId" },
  ],
  filters: [
    { field: "status", label: "Status", type: "select", options: HYPOTHESIS_STATUS },
    { field: "confidence", label: "Confidence", type: "select", options: LEARNING_CONFIDENCE },
    { field: "domain", label: "Domain", type: "multiSelect", options: DOMAIN },
  ],
};
