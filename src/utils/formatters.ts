/**
 * Pretty-prints spotify_cli's already-clean structured JSON output for an
 * MCP tool's text content. Kept deliberately simple -- unlike an HTTP API
 * wrapper, there's no pagination/truncation machinery to build here: the
 * playlist/library list commands already expose --limit/--offset for that.
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Most spotify_cli mutation commands (playlist create/update/add/remove,
 * folder create/rename/move/remove, library add/remove) ignore --format
 * json on success and print a short human-readable line instead -- e.g.
 * "Created: My Playlist  spotify:playlist:abc123" -- confirmed via live
 * testing against a real account. SpotifyCliClient.run() returns that raw
 * text as { message } rather than throwing (a non-zero exit is still a
 * real, thrown error -- this only covers the successful-but-non-JSON case).
 * This pulls a trailing Spotify URI out of that message, if present, so a
 * tool can report the created/affected item's URI in a structured way
 * instead of just echoing raw CLI text. Handles both plain (spotify:track:x)
 * and user-scoped (spotify:user:name:folder:x) URI shapes.
 */
export function extractUriFromMessage(message: string): string | undefined {
  const match = message.match(/spotify:\S+/i);
  return match?.[0];
}

/** True when a run() result is the raw-text fallback shape ({ message: string }) rather than parsed JSON. */
export function isRawMessage(data: unknown): data is { message: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string"
  );
}

/**
 * Builds a structured, LLM-friendly response for a mutating tool whose CLI
 * command may return either real JSON or the raw-text fallback above.
 * Always includes success:true (only reachable on a successful exit) and
 * the raw CLI message when there was one; adds `uri` when a Spotify URI
 * could be extracted from that message, so callers can chain it into a
 * follow-up tool call (e.g. create_playlist's uri into add_tracks_to_playlist)
 * without needing a separate lookup call.
 */
export function formatMutationResult(data: unknown): string {
  if (isRawMessage(data)) {
    const uri = extractUriFromMessage(data.message);
    return formatJson({ success: true, message: data.message, ...(uri ? { uri } : {}) });
  }
  return formatJson(data);
}
