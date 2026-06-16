/**
 * YouTube Data API video operations (Phase D).
 *
 * Safety doctrine (ADR-015, applied to YouTube):
 *   - upload_video hard-wires privacyStatus='unlisted' — no field exists in
 *     the tool schema for callers to override. Activation (set to 'public'
 *     or 'unlisted'→'public') is a human-only step in YouTube Studio.
 *   - No `set_public`, `update_privacy_status`, or any tool that flips a
 *     video to publicly listed.
 *   - update_video_metadata edits title/desc/tags/category on UNLISTED videos
 *     only; refuses public videos (the doctrine: pause-then-edit doesn't
 *     apply since "go private then back to public" is human territory).
 *   - delete_video is allowed (cleanup direction; always safe to revoke).
 *
 * Upload protocol: googleapis' videos.insert wraps Google's multipart
 * upload (single POST with metadata + bytes). Bounded ~128GB in theory;
 * practically tested for files up to a few hundred MB. For very large
 * files, resumable upload would be a v1.5 enhancement.
 */
import { readFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getYouTubeClient } from "./auth.js";

// YouTube category IDs (full list at https://developers.google.com/youtube/v3/docs/videoCategories/list).
// Defaulting to 27 (Education) for engineerdad finance/parenting content.
const DEFAULT_CATEGORY_ID = "27";

export interface UploadVideoInput {
  local_path: string;
  title: string;
  description?: string;
  tags?: string[];
  /** Numeric YouTube category ID as string. Defaults to "27" (Education). */
  category_id?: string;
  /** ISO 639-1 language code of the spoken language. */
  default_language?: "en" | "ms";
  /** Override MIME type (default: video/mp4). */
  mime_type?: string;
  /** Self-declare made-for-kids. Defaults to false. YouTube requires an explicit answer. */
  made_for_kids?: boolean;
}

export interface UploadVideoResult {
  video_id: string;
  title: string;
  privacy_status: "unlisted";
  upload_status: string;
  url: string;
}

export async function uploadVideo(input: UploadVideoInput): Promise<UploadVideoResult> {
  if (!existsSync(input.local_path)) {
    throw new Error(`upload_video: local_path does not exist: ${input.local_path}`);
  }

  const youtube = getYouTubeClient();
  const body = createReadStream(input.local_path);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: input.title,
        description: input.description ?? "",
        tags: input.tags ?? [],
        categoryId: input.category_id ?? DEFAULT_CATEGORY_ID,
        defaultLanguage: input.default_language,
        defaultAudioLanguage: input.default_language,
      },
      status: {
        // SAFETY: hard-wired unlisted. Never accept caller override (no field
        // exists in UploadVideoInput). Activation (→ "public") is a human
        // step in YouTube Studio.
        privacyStatus: "unlisted",
        selfDeclaredMadeForKids: input.made_for_kids ?? false,
        embeddable: true,
      },
    },
    media: {
      mimeType: input.mime_type ?? "video/mp4",
      body,
    },
  });

  const video_id = res.data.id;
  if (!video_id) {
    throw new Error(`upload_video: YouTube returned no video id: ${JSON.stringify(res.data)}`);
  }
  return {
    video_id,
    title: res.data.snippet?.title ?? input.title,
    privacy_status: "unlisted",
    upload_status: res.data.status?.uploadStatus ?? "unknown",
    url: `https://youtu.be/${video_id}`,
  };
}

// ──────────────────── get_video_status ────────────────────

export interface GetVideoStatusInput {
  video_id: string;
}

export interface GetVideoStatusResult {
  video_id: string;
  title?: string | null;
  privacy_status?: string | null;
  upload_status?: string | null;
  processing_status?: string | null;
  duration_seconds?: number | null;
}

function parseIso8601DurationSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mins * 60 + s;
}

export async function getVideoStatus(input: GetVideoStatusInput): Promise<GetVideoStatusResult> {
  const youtube = getYouTubeClient();
  const res = await youtube.videos.list({
    part: ["snippet", "status", "processingDetails", "contentDetails"],
    id: [input.video_id],
  });
  const item = res.data.items?.[0];
  if (!item) {
    throw new Error(`get_video_status: no video found with id ${input.video_id}`);
  }
  return {
    video_id: input.video_id,
    title: item.snippet?.title,
    privacy_status: item.status?.privacyStatus,
    upload_status: item.status?.uploadStatus,
    processing_status: item.processingDetails?.processingStatus,
    duration_seconds: parseIso8601DurationSeconds(item.contentDetails?.duration),
  };
}

// ──────────────────── update_video_metadata (guarded for public videos) ────────────────────

export interface UpdateVideoMetadataInput {
  video_id: string;
  title?: string;
  description?: string;
  tags?: string[];
  category_id?: string;
  default_language?: "en" | "ms";
}

export interface UpdateVideoMetadataResult {
  video_id: string;
  applied: string[];
  privacy_status: string;
}

export async function updateVideoMetadata(
  input: UpdateVideoMetadataInput,
): Promise<UpdateVideoMetadataResult> {
  const youtube = getYouTubeClient();

  // Read current state for the guard + as the merge base (videos.update is a PUT, not PATCH).
  const cur = await youtube.videos.list({
    part: ["snippet", "status"],
    id: [input.video_id],
  });
  const item = cur.data.items?.[0];
  if (!item) {
    throw new Error(`update_video_metadata: no video found with id ${input.video_id}`);
  }
  const privacy = item.status?.privacyStatus ?? "unknown";
  if (privacy === "public") {
    throw new Error(
      `REFUSED: video is public (privacy_status=${privacy}). Public-video edits are human territory in YouTube Studio. Set privacy back to unlisted manually first if you need to edit.`,
    );
  }

  const currentSnippet = item.snippet ?? {};
  const applied: string[] = [];
  const nextSnippet: Record<string, unknown> = {
    title: currentSnippet.title ?? "",
    description: currentSnippet.description ?? "",
    tags: currentSnippet.tags ?? [],
    categoryId: currentSnippet.categoryId ?? DEFAULT_CATEGORY_ID,
    defaultLanguage: currentSnippet.defaultLanguage,
    defaultAudioLanguage: currentSnippet.defaultAudioLanguage,
  };
  if (input.title !== undefined) {
    nextSnippet["title"] = input.title;
    applied.push("title");
  }
  if (input.description !== undefined) {
    nextSnippet["description"] = input.description;
    applied.push("description");
  }
  if (input.tags !== undefined) {
    nextSnippet["tags"] = input.tags;
    applied.push("tags");
  }
  if (input.category_id !== undefined) {
    nextSnippet["categoryId"] = input.category_id;
    applied.push("categoryId");
  }
  if (input.default_language !== undefined) {
    nextSnippet["defaultLanguage"] = input.default_language;
    nextSnippet["defaultAudioLanguage"] = input.default_language;
    applied.push("defaultLanguage");
  }

  if (applied.length === 0) {
    return { video_id: input.video_id, applied: [], privacy_status: privacy };
  }

  await youtube.videos.update({
    part: ["snippet"],
    requestBody: {
      id: input.video_id,
      snippet: nextSnippet,
    },
  });

  return { video_id: input.video_id, applied, privacy_status: privacy };
}

// ──────────────────── upload_thumbnail ────────────────────

export interface UploadThumbnailInput {
  video_id: string;
  local_path: string;
  mime_type?: string;
}

export interface UploadThumbnailResult {
  video_id: string;
  default_thumbnail_url?: string | null;
}

export async function uploadThumbnail(
  input: UploadThumbnailInput,
): Promise<UploadThumbnailResult> {
  if (!existsSync(input.local_path)) {
    throw new Error(`upload_thumbnail: local_path does not exist: ${input.local_path}`);
  }
  const youtube = getYouTubeClient();
  const bytes = await readFile(input.local_path);
  const res = await youtube.thumbnails.set({
    videoId: input.video_id,
    media: {
      mimeType: input.mime_type ?? "image/png",
      body: Readable.from(bytes),
    },
  });
  const def = res.data.items?.[0]?.default?.url;
  return { video_id: input.video_id, default_thumbnail_url: def };
}

// ──────────────────── delete_video ────────────────────

export interface DeleteVideoInput {
  video_id: string;
}

export interface DeleteVideoResult {
  video_id: string;
  deleted: true;
}

export async function deleteVideo(input: DeleteVideoInput): Promise<DeleteVideoResult> {
  const youtube = getYouTubeClient();
  await youtube.videos.delete({ id: input.video_id });
  return { video_id: input.video_id, deleted: true };
}
