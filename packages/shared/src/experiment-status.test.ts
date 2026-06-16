import { describe, expect, it } from "vitest";
import { classifyExperimentStatus } from "./experiment-status.js";

describe("classifyExperimentStatus", () => {
  it("returns 'full' when every cell is occupied", () => {
    expect(classifyExperimentStatus({ occupied: 3, total: 3 })).toBe("full");
    expect(classifyExperimentStatus({ occupied: 1, total: 1 })).toBe("full");
  });

  it("returns 'degraded' when ≥2 occupied and ≥1 empty", () => {
    expect(classifyExperimentStatus({ occupied: 2, total: 3 })).toBe("degraded");
    expect(classifyExperimentStatus({ occupied: 4, total: 5 })).toBe("degraded");
  });

  it("returns 'single-cell' when exactly 1 occupied", () => {
    expect(classifyExperimentStatus({ occupied: 1, total: 3 })).toBe("single-cell");
    expect(classifyExperimentStatus({ occupied: 1, total: 2 })).toBe("single-cell");
  });

  it("returns 'broken' when 0 occupied", () => {
    expect(classifyExperimentStatus({ occupied: 0, total: 3 })).toBe("broken");
    expect(classifyExperimentStatus({ occupied: 0, total: 0 })).toBe("broken");
  });
});
