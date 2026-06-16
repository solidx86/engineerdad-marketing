import { describe, it, expect } from "vitest";
import { assignSchedule } from "./schedule.js";

/** MYT wall-clock parts of a UTC ISO string (MYT = UTC+8). */
function mytParts(iso: string): { day: number; hour: number; minute: number } {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

const MON = new Date("2026-05-25T00:00:00.000Z"); // MYT Monday 08:00
const FRI = new Date("2026-05-22T00:00:00.000Z"); // MYT Friday 08:00

describe("assignSchedule — organic", () => {
  it("assigns a Reel the next Thursday 19:00 MYT slot, converted to UTC", () => {
    const r = assignSchedule(
      [{ variantId: "v1", format: "Reel", channels: ["Meta-organic"] }],
      { now: MON },
    );
    expect(r.organic).toHaveLength(1);
    expect(mytParts(r.organic[0]!.scheduledForUtc)).toEqual({ day: 4, hour: 19, minute: 0 });
    // Thu 19:00 MYT === 11:00 UTC
    expect(r.organic[0]!.scheduledForUtc).toBe("2026-05-28T11:00:00.000Z");
    expect(r.problems).toEqual([]);
  });

  it("fills Feed variants in order — Mon then Wed 20:00 MYT", () => {
    const r = assignSchedule(
      [
        { variantId: "v1", format: "Feed", channels: ["Meta-organic"] },
        { variantId: "v2", format: "Feed", channels: ["Meta-organic"] },
      ],
      { now: MON },
    );
    expect(r.organic.map((s) => s.variantId)).toEqual(["v1", "v2"]);
    expect(mytParts(r.organic[0]!.scheduledForUtc)).toEqual({ day: 1, hour: 20, minute: 0 });
    expect(mytParts(r.organic[1]!.scheduledForUtc)).toEqual({ day: 3, hour: 20, minute: 0 });
  });

  it("rolls a past slot forward to the next week", () => {
    // now is Friday — this week's Thursday Reel slot is already gone
    const r = assignSchedule(
      [{ variantId: "v1", format: "Reel", channels: ["Meta-organic"] }],
      { now: FRI },
    );
    expect(r.organic).toHaveLength(1);
    // skips 2026-05-21 (past), lands on the following Thursday
    expect(r.organic[0]!.scheduledForUtc).toBe("2026-05-28T11:00:00.000Z");
  });

  it("flags a slot past the 75-day window as a problem", () => {
    const variants = Array.from({ length: 12 }, (_, i) => ({
      variantId: `v${i}`,
      format: "Reel",
      channels: ["Meta-organic"],
    }));
    const r = assignSchedule(variants, { now: MON });
    expect(r.organic).toHaveLength(11); // the 12th Thursday is > now+75d
    expect(r.problems.length).toBeGreaterThanOrEqual(1);
  });
});

describe("assignSchedule — paid", () => {
  it("gives a Meta-paid variant a flight of durationDays from now", () => {
    const r = assignSchedule(
      [{ variantId: "v1", format: "Reel", channels: ["Meta-paid"] }],
      { now: MON, durationDays: 7 },
    );
    expect(r.organic).toEqual([]);
    expect(r.paid).toHaveLength(1);
    expect(r.paid[0]!.flightStartUtc).toBe("2026-05-25T00:00:00.000Z");
    expect(r.paid[0]!.flightEndUtc).toBe("2026-06-01T00:00:00.000Z");
  });
});
