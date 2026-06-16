import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateVideo, getVideoStatus, uploadAsset, generateReel } from "../heygen.js";

describe("generateVideo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.HEYGEN_API_KEY = "KEY";
  });

  it("POSTs to /v2/video/generate with avatar+voice+text+dimension", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { video_id: "job_123" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await generateVideo({
      avatar_id: "av1", voice_id: "vo1",
      input_text: "Hello", language: "en", aspect_ratio: "9:16",
    });
    expect(res).toEqual({ jobId: "job_123" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.heygen.com/v2/video/generate");
    expect((opts.headers as any)["X-Api-Key"]).toBe("KEY");
    const body = JSON.parse(opts.body as string);
    expect(body.video_inputs[0].character.avatar_id).toBe("av1");
    expect(body.video_inputs[0].voice.voice_id).toBe("vo1");
    expect(body.video_inputs[0].voice.input_text).toBe("Hello");
    expect(body.dimension).toEqual({ width: 720, height: 1280 });
    // B-033: 9:16 defaults to fit:"cover" so the 16:9 avatar fills the frame.
    expect(body.video_inputs[0].character.fit).toBe("cover");
    expect(body.video_inputs[0].character.scale).toBeUndefined();
  });

  it("maps 16:9 aspect ratio", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { video_id: "j" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateVideo({
      avatar_id: "a", voice_id: "v", input_text: "x", language: "en", aspect_ratio: "16:9",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.dimension).toEqual({ width: 1280, height: 720 });
    // 16:9 keeps "contain" — avatar already matches the canvas.
    expect(body.video_inputs[0].character.fit).toBe("contain");
  });

  it("honors fit/scale/offset overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { video_id: "j" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateVideo({
      avatar_id: "a", voice_id: "v", input_text: "x", language: "en", aspect_ratio: "9:16",
      fit: "contain", scale: 1.4, offset: { x: 0, y: 0.2 },
    });
    const c = JSON.parse(fetchMock.mock.calls[0][1].body).video_inputs[0].character;
    expect(c.fit).toBe("contain");
    expect(c.scale).toBe(1.4);
    expect(c.offset).toEqual({ x: 0, y: 0.2 });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: { message: "Invalid key" } }),
    }));
    await expect(generateVideo({
      avatar_id: "a", voice_id: "v", input_text: "x", language: "en", aspect_ratio: "9:16",
    })).rejects.toThrow(/Invalid key/);
  });
});

describe("getVideoStatus", () => {
  beforeEach(() => { vi.restoreAllMocks(); process.env.HEYGEN_API_KEY = "KEY"; });

  it("maps pending/processing → processing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { status: "processing" } }),
    }));
    expect(await getVideoStatus({ jobId: "j" })).toEqual({ status: "processing" });
  });

  it("maps completed + video_url → completed with videoUrl", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { status: "completed", video_url: "https://x/v.mp4" } }),
    }));
    expect(await getVideoStatus({ jobId: "j" })).toEqual({ status: "completed", videoUrl: "https://x/v.mp4" });
  });

  it("maps failed → failed with error.message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { status: "failed", error: { message: "render error" } } }),
    }));
    expect(await getVideoStatus({ jobId: "j" })).toEqual({ status: "failed", error: "render error" });
  });

  // ── PR 3 additive fields (per 2026-05-28-heygen-reel-pipeline §5.4) ──
  it("surfaces subtitleUrl when HeyGen returns caption_url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          status: "completed",
          video_url: "https://x/v.mp4",
          caption_url: "https://x/v.srt",
        },
      }),
    }));
    expect(await getVideoStatus({ jobId: "j" })).toEqual({
      status: "completed",
      videoUrl: "https://x/v.mp4",
      subtitleUrl: "https://x/v.srt",
    });
  });

  it("surfaces durationSeconds when HeyGen returns duration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { status: "completed", video_url: "https://x/v.mp4", duration: 27.4 },
      }),
    }));
    expect(await getVideoStatus({ jobId: "j" })).toEqual({
      status: "completed",
      videoUrl: "https://x/v.mp4",
      durationSeconds: 27.4,
    });
  });

  it("surfaces both subtitleUrl and durationSeconds when both present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          status: "completed",
          video_url: "https://x/v.mp4",
          caption_url: "https://x/v.srt",
          duration: 27.4,
        },
      }),
    }));
    expect(await getVideoStatus({ jobId: "j" })).toEqual({
      status: "completed",
      videoUrl: "https://x/v.mp4",
      subtitleUrl: "https://x/v.srt",
      durationSeconds: 27.4,
    });
  });

  it("omits subtitleUrl when caption_url is missing (older tier)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: "completed", video_url: "https://x/v.mp4" } }),
    }));
    const result = await getVideoStatus({ jobId: "j" });
    expect(result.subtitleUrl).toBeUndefined();
    expect(result.durationSeconds).toBeUndefined();
  });

  it("omits subtitleUrl when caption_url is empty string (defensive)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { status: "completed", video_url: "https://x/v.mp4", caption_url: "" },
      }),
    }));
    const result = await getVideoStatus({ jobId: "j" });
    expect(result.subtitleUrl).toBeUndefined();
  });

  it("ignores non-numeric duration values (defensive)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { status: "completed", video_url: "https://x/v.mp4", duration: "twenty-seven" },
      }),
    }));
    const result = await getVideoStatus({ jobId: "j" });
    expect(result.durationSeconds).toBeUndefined();
  });
});

describe("uploadAsset", () => {
  beforeEach(() => { vi.restoreAllMocks(); process.env.HEYGEN_API_KEY = "KEY"; });

  it("POSTs raw bytes to upload.heygen.com/v1/asset and returns {assetId,url}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "asset_1", url: "https://resource2.heygen.ai/image/asset_1/original.png" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const res = await uploadAsset({ bytes: buf, mimeType: "image/png" });
    expect(res).toEqual({ assetId: "asset_1", url: "https://resource2.heygen.ai/image/asset_1/original.png" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://upload.heygen.com/v1/asset");
    expect(opts.method).toBe("POST");
    expect((opts.headers as any)["Content-Type"]).toBe("image/png");
    expect((opts.headers as any)["X-Api-Key"]).toBe("KEY");
    expect(opts.body).toBe(buf);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 413, json: async () => ({ message: "too big" }) }));
    await expect(uploadAsset({ bytes: Buffer.from([0]), mimeType: "image/png" })).rejects.toThrow(/too big|413/);
  });
});

describe("generateReel", () => {
  beforeEach(() => { vi.restoreAllMocks(); process.env.HEYGEN_API_KEY = "KEY"; });

  it("builds a multi-scene video_inputs payload with caption + per-scene shapes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { video_id: "vid_1" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await generateReel({
      avatar_id: "av1", voice_id: "vo1", aspect_ratio: "9:16",
      scenes: [
        { kind: "face",   voiceover: "Hook line." },
        { kind: "visual", voiceover: "Visual line.", chart_url: "https://x/frame.png" },
      ],
    });
    expect(res.jobId).toBe("vid_1");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.video_inputs).toHaveLength(2);
    const face = body.video_inputs[0];
    expect(face.character).toMatchObject({ type: "avatar", avatar_id: "av1", fit: "cover" });
    expect(face.background).toEqual({ type: "color", value: "#0a1628" });
    const visual = body.video_inputs[1];
    expect(visual.character).toBeUndefined();
    expect(visual.voice.input_text).toBe("Visual line.");
    expect(visual.background).toEqual({ type: "image", url: "https://x/frame.png", fit: "cover" });
  });

  it("throws if a visual scene is missing chart_url", async () => {
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { video_id: "vid_2" } }) });
    await expect(
      generateReel({
        avatar_id: "av1", voice_id: "vo1", aspect_ratio: "9:16",
        scenes: [{ kind: "visual", voiceover: "x" }],
      }),
    ).rejects.toThrow(/requires chart_url/);
  });
});
