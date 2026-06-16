import { graphPost } from "../graph.js";
import { requireEnv } from "../auth.js";
import { validateScheduledPublishTime } from "../validation.js";
import { preflightCompliance } from "../compliance.js";
import type { Lang } from "@engineerdad/shared";

export type PublishArgs = {
  variantId: string;
  platform: "ig" | "fb";
  imageUrl: string;
  caption: string;
  lang: Lang; // required for compliance scanner
  scheduledPublishTime: number; // unix seconds
  nowUnix?: number; // testable
};

export async function publishImagePost(
  args: PublishArgs
): Promise<{ postId: string; platform: "ig" | "fb" }> {
  validateScheduledPublishTime(args.scheduledPublishTime, args.nowUnix);
  preflightCompliance({ caption: args.caption, lang: args.lang });
  const { pageId, igUserId } = requireEnv();

  if (args.platform === "ig") {
    const container = await graphPost(`${igUserId}/media`, {
      image_url: args.imageUrl,
      caption: args.caption,
    });
    const published = await graphPost(`${igUserId}/media_publish`, {
      creation_id: container.id,
      // IG scheduled-publish: include scheduled_publish_time on the publish call
      scheduled_publish_time: args.scheduledPublishTime,
    });
    return { postId: published.id, platform: "ig" };
  }

  // FB Page single-image post (B-007).
  // Mirrors publish-carousel-post.ts: upload the photo UNPUBLISHED, then attach
  // it to a scheduled /feed post. Posting scheduling params straight to /photos
  // is an undocumented combination — it does schedule, but the resulting post is
  // invisible in Business Suite's Scheduled tab (can't be inspected/cancelled by
  // hand). /feed + attached_media is Meta's documented scheduling path and the
  // post shows up in Business Suite like any other scheduled post.
  const photo = await graphPost(`${pageId}/photos`, {
    url: args.imageUrl,
    published: false,
  });
  const post = await graphPost(`${pageId}/feed`, {
    message: args.caption,
    attached_media: [{ media_fbid: photo.id }],
    published: false,
    unpublished_content_type: "SCHEDULED",
    scheduled_publish_time: args.scheduledPublishTime,
  });
  return { postId: post.id, platform: "fb" };
}
