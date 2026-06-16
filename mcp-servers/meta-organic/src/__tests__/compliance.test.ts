import { describe, expect, it, vi, beforeEach } from "vitest";
import { complianceScan } from "@engineerdad/shared";
import { preflightCompliance } from "../compliance.js";

vi.mock("@engineerdad/shared", async () => {
  const actual = await vi.importActual<any>("@engineerdad/shared");
  return {
    ...actual,
    complianceScan: vi.fn((text: string) =>
      text.includes("guaranteed return") || text.includes("pulangan terjamin")
        ? {
            ok: false,
            violations: [
              {
                kind: "banned",
                name: text.includes("guaranteed return")
                  ? "guaranteed return"
                  : "pulangan terjamin",
                reason: "sc-malaysia: prohibited claim",
                match: text.includes("guaranteed return")
                  ? "guaranteed return"
                  : "pulangan terjamin",
              },
            ],
          }
        : { ok: true, violations: [] }
    ),
  };
});

beforeEach(() => {
  vi.mocked(complianceScan).mockClear();
});

describe("preflightCompliance", () => {
  it("passes clean caption (EN)", () => {
    expect(() =>
      preflightCompliance({ caption: "Educational content on PRS.", lang: "en" })
    ).not.toThrow();
  });

  it("throws compliance_block on banned phrase (EN)", () => {
    expect(() =>
      preflightCompliance({ caption: "guaranteed return on this fund", lang: "en" })
    ).toThrow(/compliance_block/);
  });

  it("calls complianceScan with lang='ms' for BM captions", () => {
    expect(() =>
      preflightCompliance({ caption: "Dapatkan pulangan terjamin anda", lang: "ms" })
    ).toThrow(/compliance_block/);
    expect(vi.mocked(complianceScan)).toHaveBeenCalledWith(
      "Dapatkan pulangan terjamin anda",
      "ms"
    );
  });

  it("passes lang='en' through to complianceScan", () => {
    preflightCompliance({ caption: "Educational content on PRS.", lang: "en" });
    expect(vi.mocked(complianceScan)).toHaveBeenCalledWith(
      "Educational content on PRS.",
      "en"
    );
  });
});
