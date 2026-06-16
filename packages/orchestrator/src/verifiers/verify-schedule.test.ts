import { describe, it, expect } from "vitest";
import { verifySchedule } from "./verify-schedule.js";
import type { ScheduleResult } from "@engineerdad/shared/derive";

const FLIGHT = { flightStartUtc: "2026-05-25T00:00:00.000Z", flightEndUtc: "2026-06-01T00:00:00.000Z" };

describe("verifySchedule", () => {
  it("passes a complete result — every channel covered", () => {
    const variants = [
      { variantId: "v1", channels: ["Meta-organic"] },
      { variantId: "v2", channels: ["Meta-paid"] },
    ];
    const result: ScheduleResult = {
      organic: [{ variantId: "v1", scheduledForUtc: "2026-05-28T11:00:00.000Z" }],
      paid: [{ variantId: "v2", ...FLIGHT }],
      problems: [],
    };
    expect(verifySchedule(variants, result)).toEqual({ ok: true, problems: [] });
  });

  it("fails a Meta-organic variant with no organic slot", () => {
    const result: ScheduleResult = { organic: [], paid: [], problems: [] };
    const v = verifySchedule([{ variantId: "v1", channels: ["Meta-organic"] }], result);
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  it("fails a Meta-paid variant with no paid flight", () => {
    const result: ScheduleResult = { organic: [], paid: [], problems: [] };
    const v = verifySchedule([{ variantId: "v1", channels: ["Meta-paid"] }], result);
    expect(v.ok).toBe(false);
  });

  it("carries through problems assignSchedule already surfaced", () => {
    const result: ScheduleResult = { organic: [], paid: [], problems: ["slot past window"] };
    expect(verifySchedule([], result).ok).toBe(false);
  });
});
