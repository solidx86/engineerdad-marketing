import { describe, it, expect } from "vitest";
import { currentGate } from "./gate";

describe("currentGate()", () => {
  it("returns null when status is active (no gate awaiting)", () => {
    expect(currentGate({ stage: "produce", status: "active" })).toBeNull();
  });
  it("maps brief + awaiting_gate → HG1", () => {
    expect(currentGate({ stage: "brief", status: "awaiting_gate" })).toBe("HG1");
  });
  it("maps content + awaiting_gate → HG2", () => {
    expect(currentGate({ stage: "content", status: "awaiting_gate" })).toBe("HG2");
  });
  it("maps produce + awaiting_gate → HG3", () => {
    expect(currentGate({ stage: "produce", status: "awaiting_gate" })).toBe("HG3");
  });
  it("maps distribute + awaiting_gate → HG4", () => {
    expect(currentGate({ stage: "distribute", status: "awaiting_gate" })).toBe("HG4");
  });
  it("returns null when status is done regardless of stage", () => {
    expect(currentGate({ stage: "produce", status: "done" })).toBeNull();
  });
  it("returns null when stage is one that doesn't have a gate (e.g., schedule)", () => {
    expect(currentGate({ stage: "schedule", status: "awaiting_gate" })).toBeNull();
  });
});
