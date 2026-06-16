import { graphDelete } from "../graph.js";

export async function deletePost(args: { postId: string }) {
  return await graphDelete(args.postId);
}
