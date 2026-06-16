import { graphGet } from "../graph.js";

export async function getPostStatus(args: { postId: string; platform: "ig" | "fb" }) {
  if (args.platform === "ig") {
    return await graphGet(args.postId, { fields: "id,status,scheduled_publish_time,permalink" });
  }
  return await graphGet(args.postId, { fields: "id,is_published,scheduled_publish_time,permalink_url" });
}
