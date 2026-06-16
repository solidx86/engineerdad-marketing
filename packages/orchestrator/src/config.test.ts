import { describe, it, expect, afterEach } from "vitest";
import { metaPaidMode } from "./config.js";

afterEach(() => { delete process.env.META_PAID_MODE; });

describe("metaPaidMode", () => {
  it("defaults to manual", () => { expect(metaPaidMode()).toBe("manual"); });
  it("returns api when set", () => { process.env.META_PAID_MODE = "api"; expect(metaPaidMode()).toBe("api"); });
  it("falls back to manual for garbage", () => { process.env.META_PAID_MODE = "xyz"; expect(metaPaidMode()).toBe("manual"); });
});
