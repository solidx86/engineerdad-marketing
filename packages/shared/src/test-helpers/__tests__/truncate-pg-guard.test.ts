import { describe, it, expect, afterEach, vi } from "vitest";

describe("truncatePg module-load guard", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    vi.resetModules();
  });

  it("throws when DATABASE_URL points at live DB", async () => {
    process.env.DATABASE_URL = "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";
    vi.resetModules();
    await expect(import("../truncate-pg.js")).rejects.toThrow(
      "truncatePg() refuses to run"
    );
  });

  it("throws when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    await expect(import("../truncate-pg.js")).rejects.toThrow(
      "truncatePg() refuses to run"
    );
  });

  it("does not throw when DATABASE_URL ends with _test", async () => {
    process.env.DATABASE_URL =
      "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test";
    vi.resetModules();
    await expect(import("../truncate-pg.js")).resolves.toBeDefined();
  });

  it("does not throw when DATABASE_URL contains engineerdad_sb_", async () => {
    process.env.DATABASE_URL =
      "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_sb_my_branch";
    vi.resetModules();
    await expect(import("../truncate-pg.js")).resolves.toBeDefined();
  });
});
