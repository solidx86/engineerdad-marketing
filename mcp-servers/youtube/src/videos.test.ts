import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { uploadVideo, uploadThumbnail } from "./videos.js";
import { _resetAuthCacheForTests } from "./auth.js";

const originalEnv = { ...process.env };

describe("uploadVideo / uploadThumbnail — input validation", () => {
  beforeEach(() => {
    // Fake env so auth doesn't throw on env-var-missing before we hit the
    // local_path check we actually want to exercise.
    process.env["YOUTUBE_OAUTH_CLIENT_ID"] = "test-client-id";
    process.env["YOUTUBE_OAUTH_CLIENT_SECRET"] = "test-secret";
    process.env["YOUTUBE_OAUTH_REFRESH_TOKEN"] = "test-refresh";
    _resetAuthCacheForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetAuthCacheForTests();
  });

  it("uploadVideo refuses a local_path that doesn't exist", async () => {
    await expect(
      uploadVideo({
        local_path: "/tmp/this-video-does-not-exist-zzz.mp4",
        title: "Test",
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it("uploadThumbnail refuses a local_path that doesn't exist", async () => {
    await expect(
      uploadThumbnail({
        video_id: "abc123",
        local_path: "/tmp/this-thumbnail-does-not-exist-zzz.png",
      }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("auth — env-var validation", () => {
  const REQUIRED = [
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_OAUTH_REFRESH_TOKEN",
  ];

  beforeEach(() => {
    for (const k of REQUIRED) delete process.env[k];
    _resetAuthCacheForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetAuthCacheForTests();
  });

  for (const missing of REQUIRED) {
    it(`refuses when ${missing} is unset`, async () => {
      for (const k of REQUIRED) {
        if (k !== missing) process.env[k] = "test-value";
      }
      const { getOAuthClient } = await import("./auth.js");
      _resetAuthCacheForTests();
      expect(() => getOAuthClient()).toThrow(new RegExp(missing));
    });
  }
});
