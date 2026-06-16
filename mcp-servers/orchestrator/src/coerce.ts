/**
 * Recover a structured `result` that the MCP tool-call boundary serialized as a
 * JSON string. The `verify` / `advance` tools type `result` as `z.unknown()`
 * (an untyped `{}` schema); a conductor's array/object argument can arrive as
 * JSON text rather than a parsed value, which breaks every shape-inspecting
 * verifier (`Array.isArray` checks fail on a string). Parse it back when it
 * looks like JSON; pass everything else through untouched. (B-011)
 */
export function coerceResult(result: unknown): unknown {
  if (typeof result !== "string") return result;
  const trimmed = result.trim();
  if (trimmed.length === 0 || !(trimmed.startsWith("[") || trimmed.startsWith("{"))) {
    return result;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return result;
  }
}
