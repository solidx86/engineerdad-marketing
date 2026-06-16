// packages/orchestrator/src/webapp-url.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { reviewUiUrl, webappUrl } from "./webapp-url.js";

describe("webappUrl()", () => {
  const orig = { ...process.env };
  beforeEach(() => { delete process.env.WEBAPP_URL; delete process.env.REVIEW_UI_URL; });
  afterEach(() => { process.env = { ...orig }; });

  it("defaults to http://localhost:3030 with no env", () => {
    expect(webappUrl()).toBe("http://localhost:3030");
  });
  it("uses WEBAPP_URL when set", () => {
    process.env.WEBAPP_URL = "https://wa.example.com/";
    expect(webappUrl()).toBe("https://wa.example.com");
  });
  it("falls back to REVIEW_UI_URL when WEBAPP_URL absent", () => {
    process.env.REVIEW_UI_URL = "https://legacy.example.com/";
    expect(webappUrl()).toBe("https://legacy.example.com");
  });
  it("prefers WEBAPP_URL over REVIEW_UI_URL when both set", () => {
    process.env.WEBAPP_URL = "https://new.example.com";
    process.env.REVIEW_UI_URL = "https://old.example.com";
    expect(webappUrl()).toBe("https://new.example.com");
  });
  it("keeps reviewUiUrl() working as a deprecated alias", () => {
    process.env.REVIEW_UI_URL = "https://legacy.example.com";
    expect(reviewUiUrl()).toBe("https://legacy.example.com");
  });
});
