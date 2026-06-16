/**
 * assignSchedule — organic per-post datetimes + paid flight windows. Pure:
 * `now` is injected so the result is deterministic. The organic cadence table
 * (MYT) is inherited from the retired distribution agent's §4d.
 */

export interface ScheduleInput {
  variantId: string;
  format: string; // Reel | Feed | Carousel | YT-Long | YT-Short
  channels: string[]; // Meta-organic ⇒ organic branch; Meta-paid ⇒ paid branch
}

export interface OrganicSlot {
  variantId: string;
  scheduledForUtc: string; // ISO
}

export interface PaidFlight {
  variantId: string;
  flightStartUtc: string;
  flightEndUtc: string;
}

export interface ScheduleResult {
  organic: OrganicSlot[];
  paid: PaidFlight[];
  problems: string[]; // a slot outside the publish window, an un-routable format
}

/** A cadence slot: weekday (Sun=0..Sat=6) + MYT wall-clock time. */
interface CadenceSlot {
  day: number;
  hour: number;
  minute: number;
}

/** MYT posting cadence by format (retired distribution agent §4d). */
const CADENCE: Record<string, CadenceSlot[]> = {
  Feed: [
    { day: 1, hour: 20, minute: 0 },
    { day: 3, hour: 20, minute: 0 },
    { day: 5, hour: 18, minute: 0 },
  ],
  Image: [
    { day: 1, hour: 20, minute: 0 },
    { day: 3, hour: 20, minute: 0 },
    { day: 5, hour: 18, minute: 0 },
  ],
  Carousel: [{ day: 2, hour: 19, minute: 0 }],
  Reel: [{ day: 4, hour: 19, minute: 0 }],
};

const MYT_OFFSET_MS = 8 * 3600 * 1000;
const LEAD_MS = 10 * 60 * 1000; // a slot must be ≥ now + 10min
const WINDOW_DAYS = 75; // …and ≤ now + 75d
const DEFAULT_FLIGHT_DAYS = 7;
const ORGANIC = "Meta-organic";
const PAID = "Meta-paid";

/** Future cadence-slot instants (ms UTC) for `format`, sorted, ≥ `needed` of them. */
function generateSlots(format: string, now: Date, needed: number): number[] {
  const cadence = CADENCE[format];
  if (!cadence) return [];
  // Shift the instant by the MYT offset, then read UTC fields — they now read
  // as MYT wall-clock fields.
  const nowMyt = new Date(now.getTime() + MYT_OFFSET_MS);
  const y = nowMyt.getUTCFullYear();
  const m = nowMyt.getUTCMonth();
  const d = nowMyt.getUTCDate();
  const sinceMon = (nowMyt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const lower = now.getTime() + LEAD_MS;
  const weeks = Math.ceil(needed / cadence.length) + 4;
  const out: number[] = [];
  for (let k = 0; k < weeks; k++) {
    for (const c of cadence) {
      const deltaDays = ((c.day + 6) % 7) - sinceMon + 7 * k;
      // Date.UTC normalizes day overflow; subtract the offset to land in real UTC.
      out.push(Date.UTC(y, m, d + deltaDays, c.hour, c.minute, 0) - MYT_OFFSET_MS);
    }
  }
  return out.sort((a, b) => a - b).filter((t) => t > lower);
}

/**
 * Organic: each Meta-organic variant gets the next free cadence slot for its
 * format (variant order), MYT→UTC; a slot past the 75-day window is a problem.
 * Paid: each Meta-paid variant gets a flight of `durationDays` from `now`.
 */
export function assignSchedule(
  variants: ScheduleInput[],
  opts: { now: Date; durationDays?: number },
): ScheduleResult {
  const { now } = opts;
  const flightDays = opts.durationDays ?? DEFAULT_FLIGHT_DAYS;
  const upper = now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000;

  const organic: OrganicSlot[] = [];
  const paid: PaidFlight[] = [];
  const problems: string[] = [];

  // Size each per-format slot stream to the organic demand for that format.
  const demand = new Map<string, number>();
  for (const v of variants) {
    if (v.channels.includes(ORGANIC)) {
      demand.set(v.format, (demand.get(v.format) ?? 0) + 1);
    }
  }
  const streams = new Map<string, number[]>();
  for (const [format, n] of demand) {
    streams.set(format, generateSlots(format, now, n));
  }
  const cursor = new Map<string, number>();

  for (const v of variants) {
    if (v.channels.includes(ORGANIC)) {
      if (!CADENCE[v.format]) {
        problems.push(`${v.variantId}: no organic cadence for format ${v.format}`);
      } else {
        const i = cursor.get(v.format) ?? 0;
        cursor.set(v.format, i + 1);
        const slot = streams.get(v.format)?.[i];
        if (slot === undefined) {
          problems.push(`${v.variantId}: no organic slot available`);
        } else if (slot > upper) {
          problems.push(
            `${v.variantId}: organic slot ${new Date(slot).toISOString()} is past the ${WINDOW_DAYS}-day window`,
          );
        } else {
          organic.push({
            variantId: v.variantId,
            scheduledForUtc: new Date(slot).toISOString(),
          });
        }
      }
    }
    if (v.channels.includes(PAID)) {
      const end = new Date(now.getTime() + flightDays * 24 * 3600 * 1000);
      paid.push({
        variantId: v.variantId,
        flightStartUtc: now.toISOString(),
        flightEndUtc: end.toISOString(),
      });
    }
  }

  return { organic, paid, problems };
}
