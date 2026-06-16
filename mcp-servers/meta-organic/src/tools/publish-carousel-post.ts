import { graphPost } from "../graph.js";
import { requireEnv } from "../auth.js";
import { validateScheduledPublishTime } from "../validation.js";
import { preflightCompliance } from "../compliance.js";
import type { Lang } from "@engineerdad/shared";

export type CarouselArgs = {
  variantId: string;
  platform: "ig" | "fb";
  imageUrls: string[];
  caption: string;
  lang: Lang;
  scheduledPublishTime: number; // unix seconds
  nowUnix?: number; // testable
};

export async function publishCarouselPost(
  args: CarouselArgs
): Promise<{ postId: string; platform: "ig" | "fb" }> {
  validateScheduledPublishTime(args.scheduledPublishTime, args.nowUnix);
  preflightCompliance({ caption: args.caption, lang: args.lang });
  const { pageId, igUserId } = requireEnv();

  if (args.platform === "ig") {
    // Step 1: create one child container per image
    const childIds: string[] = [];
    for (const url of args.imageUrls) {
      const c = await graphPost(`${igUserId}/media`, {
        image_url: url,
        is_carousel_item: true,
      });
      childIds.push(c.id);
    }
    // Step 2: create parent carousel container
    const parent = await graphPost(`${igUserId}/media`, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: args.caption,
    });
    // Step 3: publish
    const published = await graphPost(`${igUserId}/media_publish`, {
      creation_id: parent.id,
      scheduled_publish_time: args.scheduledPublishTime,
    });
    return { postId: published.id, platform: "ig" };
  }

  // FB Page multi-photo: pre-upload each as unpublished photo, then attach by id
  const mediaIds: string[] = [];
  for (const url of args.imageUrls) {
    const ph = await graphPost(`${pageId}/photos`, { url, published: false });
    mediaIds.push(ph.id);
  }
  const post = await graphPost(`${pageId}/feed`, {
    message: args.caption,
    attached_media: mediaIds.map((id) => ({ media_fbid: id })),
    published: false,
    unpublished_content_type: "SCHEDULED",
    scheduled_publish_time: args.scheduledPublishTime,
  });
  return { postId: post.id, platform: "fb" };
}
