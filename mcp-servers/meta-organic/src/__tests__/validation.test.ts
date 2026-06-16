import { describe, expect, it } from "vitest";
import { validateScheduledPublishTime } from "../validation.js";

describe("validateScheduledPublishTime (ADR-019)", () => {
  const NOW = 1_700_000_000; // fixed for test

  it("accepts time ≥ now + 10 min and ≤ now + 75 days", () => {
    expect(() => validateScheduledPublishTime(NOW + 600, NOW)).not.toThrow();
    expect(() => validateScheduledPublishTime(NOW + 75 * 86400, NOW)).not.toThrow();
  });

  it("rejects time < now + 10 min with immediate_publish_disabled", () => {
    expect(() => validateScheduledPublishTime(NOW + 300, NOW)).toThrow(/immediate_publish_disabled/);
    expect(() => validateScheduledPublishTime(NOW, NOW)).toThrow(/immediate_publish_disabled/);
    expect(() => validateScheduledPublishTime(NOW - 100, NOW)).toThrow(/immediate_publish_disabled/);
  });

  it("rejects time > now + 75 days with out_of_schedule_window", () => {
    expect(() => validateScheduledPublishTime(NOW + 76 * 86400, NOW)).toThrow(/out_of_schedule_window/);
  });
});
