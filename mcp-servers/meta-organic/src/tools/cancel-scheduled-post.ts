import { graphDelete } from "../graph.js";

export async function cancelScheduledPost(args: { postId: string }) {
  return await graphDelete(args.postId);
}
