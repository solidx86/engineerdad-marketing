const API = "https://api.heygen.com";

function requireKey(): string {
  const k = process.env.HEYGEN_API_KEY;
  if (!k) throw new Error("HEYGEN_API_KEY not set");
  return k;
}

const DIMENSIONS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 720, height: 1280 },
  "16:9": { width: 1280, height: 720 },
  "1:1": { width: 720, height: 720 },
};

// Per-aspect avatar fit. HeyGen's avatar "looks" are shot 16:9; on a 9:16
// canvas the default "contain" fit letterboxes the avatar into a ~32%-height
// band with background padding (B-033). `character.fit: "cover"` scales the
// avatar to fill the frame edge-to-edge instead (cropping the sides of the
// 16:9 source) — empirically the cleanest fix, verified on avatar ff20be97…
// (closeUp does NOT reframe; manual scale/offset works but needs a tuned magic
// number — cover handles it natively). 16:9 / 1:1 stay "contain" since the
// avatar already matches those canvases.
const FIT: Record<string, "cover" | "contain"> = {
  "9:16": "cover",
  "16:9": "contain",
  "1:1": "contain",
};

export async function generateVideo(args: {
  avatar_id: string;
  voice_id: string;
  input_text: string;
  language: "en" | "ms";
  aspect_ratio: "9:16" | "16:9" | "1:1";
  /** Override the per-aspect default fit. "cover" fills + crops; "contain" letterboxes. */
  fit?: "cover" | "contain";
  /** Fine-tune framing (only honored with the default fit; cover usually suffices). */
  scale?: number;
  offset?: { x: number; y: number };
  avatar_style?: "normal" | "closeUp" | "circle";
  background_color?: string;
}): Promise<{ jobId: string }> {
  const key = requireKey();
  const dim = DIMENSIONS[args.aspect_ratio];
  if (!dim) throw new Error(`unsupported aspect_ratio: ${args.aspect_ratio}`);
  const character: Record<string, unknown> = {
    type: "avatar",
    avatar_id: args.avatar_id,
    avatar_style: args.avatar_style ?? "normal",
    fit: args.fit ?? FIT[args.aspect_ratio]!,
  };
  if (args.scale !== undefined) character.scale = args.scale;
  if (args.offset !== undefined) character.offset = args.offset;
  const body = {
    video_inputs: [{
      character,
      voice: { type: "text", input_text: args.input_text, voice_id: args.voice_id },
      background: { type: "color", value: args.background_color ?? "#0a1628" },
    }],
    dimension: dim,
  };
  const res = await fetch(`${API}/v2/video/generate`, {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    throw new Error(`HeyGen error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return { jobId: json.data.video_id };
}

export async function uploadAsset(args: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<{ assetId: string; url: string }> {
  const key = requireKey();
  const res = await fetch("https://upload.heygen.com/v1/asset", {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": args.mimeType },
    body: args.bytes,
  });
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    throw new Error(`HeyGen upload error (${res.status}): ${json.message ?? json.error?.message ?? "unknown"}`);
  }
  return { assetId: json.data.id, url: json.data.url };
}

export interface ReelSceneInput {
  kind: "face" | "visual";
  voiceover: string;
  /** Required for visual scenes: the uploaded full-frame image (chart/concept) URL. */
  chart_url?: string;
}

export async function generateReel(args: {
  avatar_id: string;
  voice_id: string;
  aspect_ratio: "9:16" | "16:9" | "1:1";
  scenes: ReelSceneInput[];
  caption?: boolean;
  background_color?: string;
}): Promise<{ jobId: string }> {
  const key = requireKey();
  if (!args.scenes.length) throw new Error("generateReel: scenes must not be empty");
  const dim = DIMENSIONS[args.aspect_ratio];
  if (!dim) throw new Error(`unsupported aspect_ratio: ${args.aspect_ratio}`);
  const bg = args.background_color ?? "#0a1628";

  const video_inputs = args.scenes.map((s) => {
    const voice = { type: "text", input_text: s.voiceover, voice_id: args.voice_id };
    if (s.kind === "face") {
      return {
        character: { type: "avatar", avatar_id: args.avatar_id, avatar_style: "normal", fit: FIT[args.aspect_ratio]! },
        voice,
        background: { type: "color", value: bg },
      };
    }
    if (!s.chart_url) throw new Error(`scene kind '${s.kind}' requires chart_url`);
    return { voice, background: { type: "image", url: s.chart_url, fit: "cover" } };
  });

  const res = await fetch(`${API}/v2/video/generate`, {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ caption: args.caption ?? true, dimension: dim, video_inputs }),
  });
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    throw new Error(`HeyGen error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return { jobId: json.data.video_id };
}

/**
 * Poll a HeyGen render job. Returns the current status and — when completed
 * — the videoUrl plus two additive fields the Reel pipeline relies on:
 *
 *   - `subtitleUrl`: HeyGen's caption_url, the SRT for the generated audio.
 *     When the account tier returns this, the reel-render-worker uses it
 *     directly for scene-to-time alignment + caption burn-in. If absent
 *     (older tier or per-template suppression), the worker falls back to
 *     whisper-based force-alignment.
 *
 *   - `durationSeconds`: HeyGen's `duration` — the rendered audio/video
 *     length. Used by the worker for sanity-checking against the
 *     CreativeUnit's targetSeconds before stitching.
 *
 * Both are explicitly optional in the return type — older callers that
 * only consume { status, videoUrl } see no behavior change.
 */
export async function getVideoStatus(args: { jobId: string }): Promise<{
  status: "processing" | "completed" | "failed";
  videoUrl?: string;
  subtitleUrl?: string;
  durationSeconds?: number;
  error?: string;
}> {
  const key = requireKey();
  const res = await fetch(`${API}/v1/video_status.get?video_id=${encodeURIComponent(args.jobId)}`, {
    headers: { "X-Api-Key": key },
  });
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    throw new Error(`HeyGen error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  const d = json.data ?? {};
  switch (d.status) {
    case "pending":
    case "processing":
      return { status: "processing" };
    case "completed": {
      const out: {
        status: "completed";
        videoUrl: string;
        subtitleUrl?: string;
        durationSeconds?: number;
      } = { status: "completed", videoUrl: d.video_url };
      if (typeof d.caption_url === "string" && d.caption_url.length > 0) {
        out.subtitleUrl = d.caption_url;
      }
      if (typeof d.duration === "number" && Number.isFinite(d.duration)) {
        out.durationSeconds = d.duration;
      }
      return out;
    }
    case "failed":
      return { status: "failed", error: d.error?.message ?? "unknown" };
    default:
      throw new Error(`HeyGen: unrecognized status ${d.status}`);
  }
}
