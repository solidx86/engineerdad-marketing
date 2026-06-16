import { describe, it, expect } from "vitest";
import { newStepResultId, isStepResultId } from "./ulid.js";

describe("ulid", () => {
  describe("newStepResultId", () => {
    it("always starts with sr_", () => {
      for (let i = 0; i < 100; i++) {
        expect(newStepResultId().startsWith("sr_")).toBe(true);
      }
    });

    it("is exactly 29 chars (sr_ + 26-char ULID)", () => {
      expect(newStepResultId()).toHaveLength(29);
    });

    it("generates unique ids at high rate (10k smoke)", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        seen.add(newStepResultId());
      }
      expect(seen.size).toBe(10_000);
    });
  });

  describe("isStepResultId", () => {
    it("accepts ids it just generated", () => {
      expect(isStepResultId(newStepResultId())).toBe(true);
    });

    it("rejects non-strings", () => {
      expect(isStepResultId(null)).toBe(false);
      expect(isStepResultId(undefined)).toBe(false);
      expect(isStepResultId(123)).toBe(false);
      expect(isStepResultId({})).toBe(false);
      expect(isStepResultId([])).toBe(false);
    });

    it("rejects strings without the sr_ prefix", () => {
      expect(isStepResultId("brief_01ABCDEF0123456789ABCDEF")).toBe(false);
      expect(isStepResultId("01ABCDEFGHIJKLMNOPQRSTUVWX")).toBe(false);
    });

    it("rejects strings of wrong length", () => {
      expect(isStepResultId("sr_")).toBe(false);
      expect(isStepResultId("sr_short")).toBe(false);
      expect(isStepResultId("sr_01ABCDEF0123456789ABCDEFGHIJK")).toBe(false); // 32 chars
    });

    it("rejects the empty string", () => {
      expect(isStepResultId("")).toBe(false);
    });
  });
});
