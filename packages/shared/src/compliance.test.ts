import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { complianceScan, clearComplianceRulesCache } from "./compliance.js";

const RULES = resolve(__dirname, "../../../corpus/compliance/banned-phrases.yaml");

const FULL_DISCLAIMERS_EN = [
  "Shoo Kyuk Wei is a licensed UTC Consultant of Public Mutual Berhad (FIMM-registered).",
  "Past performance is not indicative of future results; investment involves risks.",
  "Please read the Master Prospectus and Product Highlights Sheet before subscribing.",
].join(" ");

describe("complianceScan", () => {
  beforeEach(() => clearComplianceRulesCache());

  it("passes a fully compliant EN draft", () => {
    const text = `Engineering your child's financial future, one ringgit at a time. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("flags banned phrase 'guaranteed returns'", () => {
    const text = `Earn guaranteed returns from our funds. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "banned" && /guaranteed/i.test(v.match ?? ""))).toBe(true);
  });

  it("flags missing consultant credential", () => {
    const text =
      "Past performance is not indicative of future results. Please read the prospectus before subscribing.";
    const r = complianceScan(text, "en", RULES);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "missing_disclaimer" && v.name === "consultant_credential")).toBe(true);
  });

  it("flags missing risk warning", () => {
    const text =
      "Shoo Kyuk Wei is a licensed UTC Consultant of Public Mutual (FIMM). Read the Master Prospectus.";
    const r = complianceScan(text, "en", RULES);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "missing_disclaimer" && v.name === "risk_warning")).toBe(true);
  });

  it("flags missing prospectus availability", () => {
    const text =
      "Shoo Kyuk Wei is a licensed UTC Consultant of Public Mutual (FIMM). Investment involves risks.";
    const r = complianceScan(text, "en", RULES);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "missing_disclaimer" && v.name === "prospectus_availability")).toBe(true);
  });

  it("flags BM-specific banned phrase", () => {
    const r = complianceScan("Pulangan dijamin untuk semua pelabur.", "ms", RULES);
    expect(r.violations.some((v) => v.kind === "banned" && /pulangan/i.test(v.name))).toBe(true);
  });

  it("flags out-of-scope products (forex / crypto / day-trade / stock-pick)", () => {
    const text = `Try our forex trading signals and crypto picks. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    const banned = r.violations.filter((v) => v.kind === "banned");
    expect(banned.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag the canonical SC §8.18 disclaimer (negation_aware)", () => {
    const text = `This fund's disclosure document has been registered with the Securities Commission Malaysia. Such registration does not amount to nor indicate that the SC has recommended or endorsed the product. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    const scViolations = r.violations.filter(
      (v) => v.kind === "banned" && /sc|securities/i.test(v.name),
    );
    expect(scViolations).toEqual([]);
  });

  it("does not flag 'not endorsed by the Securities Commission' (negation_aware)", () => {
    const text = `This product is not endorsed by the Securities Commission. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    const scViolations = r.violations.filter(
      (v) => v.kind === "banned" && /sc|securities/i.test(v.name),
    );
    expect(scViolations).toEqual([]);
  });

  it("does not flag the short SC §8.18 phrasing where negation lives inside the match", () => {
    // Real-world disclaimer used in scripts: "Registration with SC does not
    // mean SC endorses the fund." The `\bsc\b.{0,30}endorses?` pattern matches
    // "SC does not mean SC endorses" — the "does not" is INSIDE the match,
    // not before it. isNegated must scan the match span itself.
    const text = `Registration/lodgement with SC does not mean SC endorses the fund. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    const scViolations = r.violations.filter(
      (v) => v.kind === "banned" && /sc|securities/i.test(v.name),
    );
    expect(scViolations).toEqual([]);
  });

  it("still flags positive SC-endorsement claims", () => {
    const text = `Our fund is endorsed by the Securities Commission. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) => v.kind === "banned" && /securities/i.test(v.name),
      ),
    ).toBe(true);
  });

  it("still flags 'the SC approves our fund' (positive claim)", () => {
    const text = `The SC approves our high-performance fund. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some((v) => v.kind === "banned" && /sc/i.test(v.name)),
    ).toBe(true);
  });

  it("does NOT relax non-negation-aware patterns: 'not guaranteed returns' still flags", () => {
    const text = `We do not promise guaranteed returns to our investors. ${FULL_DISCLAIMERS_EN}`;
    const r = complianceScan(text, "en", RULES);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) => v.kind === "banned" && /guaranteed/i.test(v.match ?? ""),
      ),
    ).toBe(true);
  });
});
