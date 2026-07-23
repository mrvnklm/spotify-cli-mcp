import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";
import { spotifyUriSchema } from "../utils/validators.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";

export function registerPlaylistsTools(server: McpServer, client: SpotifyCliClient): void {
  server.tool(
    "get_playlist",
    "Get a playlist's metadata and (by default) its track contents. Read-only.",
    {
      uri: spotifyUriSchema.describe("The playlist's Spotify URI, e.g. spotify:playlist:..."),
      no_tracks: z
        .boolean()
        .optional()
        .describe("Omit track contents from the response, returning only playlist metadata (default: false, tracks are included)"),
      limit: z.number().int().min(1).optional().describe("Maximum number of tracks to return"),
      offset: z.number().int().min(0).optional().describe("Offset into the track list, for pagination"),
    },
    async (params) => {
      try {
        const args = ["playlist", "get", params.uri];
        if (params.no_tracks) args.push("--no-tracks");
        if (params.limit !== undefined) args.push("--limit", String(params.limit));
        if (params.offset !== undefined) args.push("--offset", String(params.offset));

        const result = await client.run(args);
        return {
          content: [{ type: "text" as const, text: formatJson(result) }],
        };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "create_playlist",
    "Create a new playlist. Additive, low risk -- does not affect any existing playlist.",
    {
      name: z.string().min(1).describe("Name for the new playlist"),
      description: z.string().optional().describe("Playlist description"),
      image_file: z.string().optional().describe("Local path to an image file (.jpg/.png) to set as cover art"),
      public: z.boolean().optional().describe("Make the playlist public (default: private)"),
    },
    async (params) => {
      try {
        const args = ["playlist", "create", params.name];
        if (params.description !== undefined) args.push("--description", params.description);
        if (params.image_file !== undefined) args.push("--image-file", params.image_file);
        if (params.public) args.push("--public");

        const result = await client.run(args);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(result) }],
        };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "update_playlist",
    "Update a playlist's name, description, cover image, or visibility. This OVERWRITES the playlist's metadata -- previous values are not recoverable through this API unless you captured them via get_playlist beforehand. Note this is weaker for cover art specifically: --image-file only accepts a local file path, so even if get_playlist returns the previous cover as a URL (not a local file), there may be no way to re-upload that exact previous image through this API.",
    {
      uri: spotifyUriSchema.describe("The playlist's Spotify URI to update"),
      name: z.string().min(1).optional().describe("New playlist name"),
      description: z.string().optional().describe("New playlist description"),
      image_file: z.string().optional().describe("Local path to an image file (.jpg/.png) to set as the new cover art"),
      visibility: z
        .enum(["public", "private"])
        .optional()
        .describe("Set the playlist's visibility to public or private"),
    },
    async (params) => {
      try {
        const args = ["playlist", "update", params.uri];
        if (params.name !== undefined) args.push("--name", params.name);
        if (params.description !== undefined) args.push("--description", params.description);
        if (params.image_file !== undefined) args.push("--image-file", params.image_file);
        if (params.visibility === "public") args.push("--public");
        if (params.visibility === "private") args.push("--private");

        const result = await client.run(args);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(result) }],
        };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "add_tracks_to_playlist",
    "Add one or more tracks to a playlist, optionally at a specific position. Additive -- does not remove or reorder any existing tracks.",
    {
      playlist_uri: spotifyUriSchema.describe("The playlist's Spotify URI to add tracks to"),
      track_uris: z
        .array(spotifyUriSchema)
        .min(1)
        .describe("One or more track URIs to add, e.g. spotify:track:..."),
      position: z.number().int().min(0).optional().describe("0-based position to insert the tracks at (default: appended to the end)"),
    },
    async (params) => {
      try {
        const args = ["playlist", "add", params.playlist_uri, ...params.track_uris];
        if (params.position !== undefined) args.push("--position", String(params.position));

        const result = await client.run(args);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(result) }],
        };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "remove_tracks_from_playlist",
    "Remove tracks at the given 0-based positions from a playlist. DESTRUCTIVE and IRREVERSIBLE via this API -- there is no built-in undo. Positions can shift after any other edit to the playlist (adds, removes, or reorders by other clients), so a position captured earlier may no longer point at the track you intend to remove. Call get_playlist first to confirm the current track order/positions immediately before removing.",
    {
      playlist_uri: spotifyUriSchema.describe("The playlist's Spotify URI to remove tracks from"),
      positions: z
        .array(z.number().int().min(0))
        .min(1)
        .describe("0-based track positions to remove, e.g. [0, 1, 5]. Fetch current positions via get_playlist first -- they can shift after other edits."),
    },
    async (params) => {
      try {
        const args = [
          "playlist",
          "remove",
          params.playlist_uri,
          "--positions",
          params.positions.join(","),
        ];

        const result = await client.run(args);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(result) }],
        };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );
}
