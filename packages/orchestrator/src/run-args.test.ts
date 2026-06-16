import { describe, it, expect } from "vitest";
import { parseRunArgs } from "./run-args.js";

describe("parseRunArgs — typed run params from the creation args string", () => {
  it("defaults dryRun to false and keeps the raw args on an empty string", () => {
    expect(parseRunArgs("")).toEqual({ args: "", dryRun: false });
  });

  it("parses --dry-run", () => {
    expect(parseRunArgs("--dry-run").dryRun).toBe(true);
  });

  it("parses --channels= into a trimmed string array", () => {
    expect(
      parseRunArgs("--channels=meta-paid,meta-organic,youtube").channelFilter,
    ).toEqual(["meta-paid", "meta-organic", "youtube"]);
  });

  it("parses --daily-budget= into a number", () => {
    expect(parseRunArgs("--daily-budget=120").dailyBudgetMyr).toBe(120);
  });

  it("parses several flags together and preserves the raw args verbatim", () => {
    const raw = "--dry-run --channels=meta-paid,youtube --daily-budget=80";
    expect(parseRunArgs(raw)).toEqual({
      args: raw,
      dryRun: true,
      channelFilter: ["meta-paid", "youtube"],
      dailyBudgetMyr: 80,
    });
  });

  it("ignores unknown tokens but keeps them in args", () => {
    const p = parseRunArgs("plan-next-week --dry-run");
    expect(p.dryRun).toBe(true);
    expect(p.args).toBe("plan-next-week --dry-run");
    expect(p.channelFilter).toBeUndefined();
  });
});
