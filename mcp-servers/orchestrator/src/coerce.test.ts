import { describe, it, expect } from "vitest";
import { coerceResult } from "./coerce.js";

describe("coerceResult — recover a structured result stringified at the MCP boundary", () => {
  it("passes a structured array through unchanged", () => {
    const arr = [{ ok: true }];
    expect(coerceResult(arr)).toBe(arr);
  });

  it("passes a structured object through unchanged", () => {
    const obj = { events_received: 1 };
    expect(coerceResult(obj)).toBe(obj);
  });

  it("parses a JSON-array string into an array", () => {
    expect(coerceResult('[{"ok":true}]')).toEqual([{ ok: true }]);
  });

  it("parses a JSON-object string into an object", () => {
    expect(coerceResult('{"events_received":1}')).toEqual({ events_received: 1 });
  });

  it("parses a JSON-array string that has surrounding whitespace", () => {
    expect(coerceResult('  [{"ok":true}]  ')).toEqual([{ ok: true }]);
  });

  it("leaves a plain non-JSON string unchanged", () => {
    expect(coerceResult("just a note")).toBe("just a note");
  });

  it("leaves a malformed JSON-looking string unchanged", () => {
    const bad = '[{"ok":true';
    expect(coerceResult(bad)).toBe(bad);
  });
});
