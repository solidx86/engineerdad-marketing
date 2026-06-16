import { describe, expect, it } from "vitest";
import { parseFigure, approxEqual, tracesTo, extractNumbers } from "./normalize.js";

describe("parseFigure", () => {
  const cases: Array<[string, number | null]> = [
    ["RM1.2M", 1_200_000],
    ["RM100,000", 100_000],
    ["143,000", 143_000],
    ["RM59,000", 59_000],
    ["41%", 0.41],
    ["~41%", 0.41],
    ["5.5%", 0.055],
    ["age 60", 60],
    ["umur 60", 60],
    ["RM2,000/mo", 2_000],
    ["13 years", 13],
    ["3 juta", 3_000_000],
    ["5k", 5_000],
    ["1.5bil", 1_500_000_000],
    ["no number here", null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(parseFigure(input)).toBe(expected);
    });
  }
});

describe("approxEqual", () => {
  it("exact integers match", () => {
    expect(approxEqual(59000, 59000)).toBe(true);
  });
  it("rounding within 1% relative matches (rounded chart values)", () => {
    expect(approxEqual(59_000, 59_400)).toBe(true);
  });
  it("derived percent ~41% matches computed ratio 0.4126", () => {
    expect(approxEqual(0.41, 0.4126)).toBe(true);
  });
  it("integer counts within ±0.5 floor match", () => {
    expect(approxEqual(13, 13)).toBe(true);
    expect(approxEqual(60, 60)).toBe(true);
  });
  it("clearly different numbers do not match", () => {
    expect(approxEqual(100_000, 143_000)).toBe(false);
    expect(approxEqual(0.41, 0.62)).toBe(false);
  });
});

describe("tracesTo", () => {
  const haystack = [0, 5, 10, 15, 18, 100_000, 86_000, 75_000, 65_000, 59_000, 0.41];

  it("RM59,000 traces to a real series value", () => {
    expect(tracesTo("RM59,000", haystack)).toBe(true);
  });
  it("41% traces to a derived caption ratio", () => {
    expect(tracesTo("41%", haystack)).toBe(true);
  });
  it("a figure absent from the chart fails the trace", () => {
    expect(tracesTo("RM1.2M", haystack)).toBe(false);
  });
  it("an unparseable figure fails the trace", () => {
    expect(tracesTo("lots of money", haystack)).toBe(false);
  });
});

describe("extractNumbers", () => {
  it("pulls canonical numbers out of a chart caption", () => {
    const caption =
      "Your statement shows RM143,000 at year 18. What it buys is RM59,000 — a ~41% loss.";
    const nums = extractNumbers(caption);
    expect(nums).toContain(143_000);
    expect(nums).toContain(18);
    expect(nums).toContain(59_000);
    expect(nums).toContain(0.41);
  });
  it("returns [] for empty / non-string", () => {
    expect(extractNumbers("")).toEqual([]);
    expect(extractNumbers(undefined as unknown as string)).toEqual([]);
  });
});
