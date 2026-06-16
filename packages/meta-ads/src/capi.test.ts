import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { capiSend, normalizeAndHash } from "./capi.js";

describe("normalizeAndHash", () => {
  it("trims, lowercases, and SHA-256 hashes", () => {
    const h = normalizeAndHash("  Test@EngineerDad.MY  ");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(normalizeAndHash("test@engineerdad.my"));
  });
});

describe("capiSend safety net", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["META_CAPI_TEST_EVENT_CODE"];
    process.env["PIXEL_ID"] = "pixel_x";
    process.env["CAPI_TOKEN"] = "token_x";
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("refuses to fire when no test_event_code is supplied and env is unset", async () => {
    await expect(
      capiSend({
        events: [
          {
            event_name: "Lead",
            event_time: 1,
            event_id: "x",
            action_source: "system_generated",
            user_data: {},
          },
        ],
      }),
    ).rejects.toThrow(/META_CAPI_TEST_EVENT_CODE/);
  });
});
