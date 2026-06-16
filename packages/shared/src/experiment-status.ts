import type { ExperimentStatus } from "./types/brain.js";

export function classifyExperimentStatus(input: {
  occupied: number;
  total: number;
}): ExperimentStatus {
  const { occupied, total } = input;
  if (occupied === 0) return "broken";
  if (occupied === total) return "full";
  if (occupied === 1) return "single-cell";
  return "degraded"; // occupied >= 2 && occupied < total
}
