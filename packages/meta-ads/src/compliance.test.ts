import { describe, it, expect } from "vitest";
import { checkCompliance } from "./compliance.js";
import { uploadImage, uploadVideo } from "./writes.js";

describe("checkCompliance", () => {
  it("accepts EN copy containing a regulator phrase", () => {
    const r = checkCompliance({
      primary_text: "Past performance is not guaranteed. Build a children's fund today.",
      lang: "en",
    });
    expect(r.ok).toBe(true);
    expect(r.matched_phrase).toBeDefined();
  });

  it("accepts MS copy containing a regulator phrase", () => {
    const r = checkCompliance({
      primary_text: "Prestasi lampau tidak menjamin pulangan masa depan. Mulakan hari ini.",
      lang: "ms",
    });
    expect(r.ok).toBe(true);
  });

  it("refuses EN copy missing any regulator phrase", () => {
    const r = checkCompliance({
      primary_text: "Invest your money easily. Compound returns for life.",
      lang: "en",
    });
    expect(r.ok).toBe(false);
    expect(r.refusal_reason).toContain("REFUSED");
  });

  it("refuses MS copy missing any regulator phrase", () => {
    const r = checkCompliance({
      primary_text: "Mulakan pelaburan anda dengan mudah. Kompaun pulangan seumur hidup.",
      lang: "ms",
    });
    expect(r.ok).toBe(false);
  });

  it("checks across primary_text + headline + description combined", () => {
    const r = checkCompliance({
      primary_text: "Build your child's future.",
      headline: "Start today",
      description: "Note: past performance is not guaranteed.",
      lang: "en",
    });
    expect(r.ok).toBe(true);
  });

  it("refuses when all three copy fields are empty", () => {
    const r = checkCompliance({ lang: "en" });
    expect(r.ok).toBe(false);
  });
});

describe("uploadImage / uploadVideo input validation", () => {
  it("uploadImage refuses when neither file_url nor local_path is provided", async () => {
    await expect(uploadImage({})).rejects.toThrow(/exactly one of/);
  });

  it("uploadImage refuses when both file_url and local_path are provided", async () => {
    await expect(
      uploadImage({ file_url: "https://example.com/x.png", local_path: "/tmp/x.png" }),
    ).rejects.toThrow(/exactly one of/);
  });

  it("uploadVideo refuses when neither file_url nor local_path is provided", async () => {
    await expect(uploadVideo({})).rejects.toThrow(/exactly one of/);
  });

  it("uploadVideo refuses when both file_url and local_path are provided", async () => {
    await expect(
      uploadVideo({ file_url: "https://example.com/x.mp4", local_path: "/tmp/x.mp4" }),
    ).rejects.toThrow(/exactly one of/);
  });

  it("uploadImage refuses a local_path that doesn't exist", async () => {
    await expect(
      uploadImage({ local_path: "/tmp/this-path-definitely-does-not-exist-zzz.png" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("uploadVideo refuses a local_path that doesn't exist", async () => {
    await expect(
      uploadVideo({ local_path: "/tmp/this-path-definitely-does-not-exist-zzz.mp4" }),
    ).rejects.toThrow(/does not exist/);
  });
});
