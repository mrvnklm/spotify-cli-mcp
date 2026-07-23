import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { spotifyUriSchema } from "../utils/validators.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";
import { ANNOTATIONS, defineTool } from "./register.js";

const libraryItemTypeSchema = z
  .enum(["album", "artist", "playlist", "folder", "show", "audiobook"])
  .describe("Filter by saved item type: album, artist, playlist, folder, show, or audiobook");

/**
 * Each op in a 'library batch' manifest always carries a required "op"
 * discriminator (library_add, library_remove, library_contains,
 * playlist_create, playlist_update, playlist_add, playlist_remove,
 * folder_create, folder_rename, folder_move, folder_remove). The remaining
 * fields vary per op type (see the 'library batch' section of
 * docs/spotify-cli-reference.txt for the full per-op field list). Modeling
 * every op variant as a discriminated union is excessive for v1 -- this
 * loosely-typed passthrough object validates the one thing every op must
 * have (a string "op" field) and lets the CLI itself validate/report on the
 * rest, same as --from-file would.
 */
const libraryBatchOpSchema = z
  .object({
    op: z
      .string()
      .describe(
        "Operation type: library_add, library_remove, library_contains, playlist_create, playlist_update, playlist_add, playlist_remove, folder_create, folder_rename, folder_move, or folder_remove"
      ),
  })
  .passthrough()
  .describe(
    [
      'A single batch operation. Fields beyond "op" depend on the operation type:',
      'library_add / library_remove / library_contains: {"uris": ["spotify:..."]}',
      'playlist_create: {"name", "description", "public": bool, "image_file": "/path/to/cover.jpg"}',
      'playlist_update: {"playlist_uri", "name", "description", "public": bool, "image_file"}',
      'playlist_add: {"playlist_uri", "track_uris": ["spotify:..."], "position": 0}',
      'playlist_remove: {"playlist_uri", "positions": [0,1,5]}',
      'folder_create: {"name", "parent_folder_uri"}',
      'folder_rename: {"folder_uri", "name"}',
      'folder_move: {"uris": ["spotify:..."], "destination_folder_uri": "root"}',
      'folder_remove: {"folder_uri", "keep_contents": bool}',
    ].join("\n")
  );

export function registerLibraryTools(server: McpServer, client: SpotifyCliClient): void {
  defineTool(
    server,
    "list_library",
    {
      description:
        "List items saved in the user's Spotify library (albums, artists, playlists, folders, shows, audiobooks). Read-only.",
      inputSchema: {
        type: libraryItemTypeSchema.optional(),
        limit: z.number().int().positive().optional().describe("Maximum number of results to return"),
        offset: z.number().int().min(0).optional().describe("Pagination offset"),
      },
      annotations: ANNOTATIONS.readOnly("List library"),
    },
    async (params) => {
      const args = ["library", "list"];
      if (params.type !== undefined) args.push("--type", params.type);
      if (params.limit !== undefined) args.push("--limit", String(params.limit));
      if (params.offset !== undefined) args.push("--offset", String(params.offset));
      return formatJson(await client.run(args));
    }
  );

  defineTool(
    server,
    "check_library_contains",
    {
      description:
        "Check whether one or more items are saved in the user's Spotify library. Read-only.",
      inputSchema: {
        uris: z
          .array(spotifyUriSchema)
          .min(1)
          .describe("Spotify URIs to check, e.g. [\"spotify:track:...\", \"spotify:album:...\"]"),
      },
      annotations: ANNOTATIONS.readOnly("Check library contains"),
    },
    async (params) => formatJson(await client.run(["library", "contains", ...params.uris]))
  );

  defineTool(
    server,
    "add_to_library",
    {
      description:
        "Add one or more items to the user's saved Spotify library. Additive and low-risk (does not affect anything already saved).",
      inputSchema: {
        uris: z
          .array(spotifyUriSchema)
          .min(1)
          .describe("Spotify URIs to add to the library, e.g. [\"spotify:track:...\", \"spotify:album:...\"]"),
      },
      // Saving an already-saved item is a no-op, so re-running is safe.
      annotations: ANNOTATIONS.additive("Add to library", true),
    },
    async (params) => formatMutationResult(await client.run(["library", "add", ...params.uris]))
  );

  defineTool(
    server,
    "remove_from_library",
    {
      description:
        "Remove (unsave) one or more items from the user's saved Spotify library. DESTRUCTIVE: this removes real saved items -- albums, artists, playlists, folders, shows, or audiobooks -- from the user's actual Spotify library. There is no built-in undo; the only way to restore a removed item is to re-add it by URI with add_to_library, and any that were saved with additional metadata (e.g. custom folder placement) may not come back exactly as they were.",
      inputSchema: {
        uris: z
          .array(spotifyUriSchema)
          .min(1)
          .describe("Spotify URIs to remove from the library, e.g. [\"spotify:track:...\", \"spotify:album:...\"]"),
      },
      annotations: ANNOTATIONS.destructive("Remove from library"),
    },
    async (params) => formatMutationResult(await client.run(["library", "remove", ...params.uris]))
  );

  defineTool(
    server,
    "run_library_batch",
    {
      description:
        "Run a sequence of mixed library/playlist/folder operations in a single spotify_cli invocation (amortizes per-process startup cost across many ops). DESTRUCTIVE DEPENDING ON CONTENTS: the ops array can include library_remove, folder_remove, and playlist_remove operations, which permanently remove saved library items, delete folders together with their nested playlists, or remove tracks from playlists -- all in bulk, in one call, with no built-in undo. IMPORTANT -- folder_remove inside a batch behaves differently from the standalone remove_folder tool: remove_folder defaults keep_contents to true (a safe override), but a folder_remove op here is passed straight through to spotify_cli, whose own default is to DELETE nested playlists unless the op explicitly sets \"keep_contents\": true. Omitting keep_contents on a folder_remove op in this batch is therefore destructive by default, not safe by default. Review the full ops array before running a batch that contains any remove/delete op, and set \"keep_contents\": true explicitly on every folder_remove op whose nested playlists should be preserved. By default the batch continues past failed ops (each result reports ok/failed); set stop_on_error to abort at the first failure instead.",
      inputSchema: {
        ops: z
          .array(libraryBatchOpSchema)
          .min(1)
          .describe("Array of batch operations to run sequentially, in order. Each entry's required fields are listed in the item schema's description."),
        stop_on_error: z
          .boolean()
          .optional()
          .describe("Abort the batch at the first failed op instead of continuing (default: false, matching the CLI's own default)"),
      },
      // Annotated destructive unconditionally: whether a given call actually
      // destroys anything depends on the ops array, and a hint that flips per
      // call is no use to a host deciding whether to prompt.
      annotations: ANNOTATIONS.destructive("Run library batch"),
    },
    async (params) => {
      const manifest: Record<string, unknown> = { ops: params.ops };
      if (params.stop_on_error !== undefined) manifest.stop_on_error = params.stop_on_error;

      const { results, summary } = await client.runBatch(manifest);
      return formatJson({ results, summary });
    }
  );
}
