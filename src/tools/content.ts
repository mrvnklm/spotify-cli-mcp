import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { formatJson } from "../utils/formatters.js";
import { spotifyUriSchema, lookupFieldsSchema } from "../utils/validators.js";
import { ANNOTATIONS, defineTool } from "./register.js";

/**
 * Search/metadata/taste/history tools. Every tool in this file is read-only:
 * none of them can change or delete any Spotify data, so (per the project's
 * minimal-safety-machinery design) their descriptions don't need destructive
 * warnings -- there is nothing here to warn about.
 */

const MAX_LOOKUP_URIS = 50;

const searchTypeSchema = z.enum([
  "track",
  "album",
  "artist",
  "playlist",
  "show",
  "episode",
  "audiobook",
]);

export function registerContentTools(server: McpServer, client: SpotifyCliClient): void {
  defineTool(
    server,
    "search",
    {
      description:
        "Search Spotify's catalog for tracks, albums, artists, playlists, shows, episodes, or audiobooks. Read-only.",
      inputSchema: {
        query: z.string().min(1).describe("Search query text"),
        type: searchTypeSchema
          .optional()
          .describe("Restrict results to a single content type: track, album, artist, playlist, show, episode, or audiobook (omit to search all types)"),
        limit: z.number().int().positive().optional().describe("Maximum number of results to return"),
      },
      annotations: ANNOTATIONS.readOnly("Search"),
    },
    async (params) => {
      const args: string[] = ["search", params.query];
      if (params.type !== undefined) args.push("--type", params.type);
      if (params.limit !== undefined) args.push("--limit", String(params.limit));
      return formatJson(await client.run(args));
    }
  );

  defineTool(
    server,
    "lookup_metadata",
    {
      description: `Resolve one or more Spotify URIs (tracks, artists, albums, etc.) to rich metadata: bpm, key, mode, camelot_key (DJ-mixing/audio features), monthly_listeners, followers, total_plays, release_date, genres, and more. Accepts MULTIPLE uris in a single call (up to ${MAX_LOOKUP_URIS}) -- prefer batching several URIs into one call over calling this tool repeatedly. Read-only.`,
      inputSchema: {
        uris: z
          .array(spotifyUriSchema)
          .min(1)
          .max(MAX_LOOKUP_URIS)
          .describe(`One or more Spotify URIs to look up (e.g. tracks, artists, albums). Pass multiple URIs in a single call for efficiency -- max ${MAX_LOOKUP_URIS} per call.`),
        fields: z
          .array(lookupFieldsSchema)
          .optional()
          .describe("Specific metadata fields to return (e.g. bpm, key, camelot_key, monthly_listeners). Omit to return all available fields."),
      },
      annotations: ANNOTATIONS.readOnly("Look up metadata"),
    },
    async (params) => {
      const args: string[] = ["lookup", ...params.uris];
      if (params.fields !== undefined && params.fields.length > 0) {
        args.push("--fields", params.fields.join(","));
      }
      return formatJson(await client.run(args));
    }
  );

  defineTool(
    server,
    "get_taste_profile",
    {
      description:
        "Get a summary of the current Spotify user's music taste profile. Takes no arguments. Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("Get taste profile"),
    },
    async () => formatJson(await client.run(["taste"]))
  );

  defineTool(
    server,
    "get_top_history",
    {
      description:
        "Get the current Spotify user's top listening history (e.g. top artists or top tracks over a time range). Read-only.",
      inputSchema: {
        type: z
          .string()
          .optional()
          .describe("Scope of top history to return (e.g. 'artists' or 'tracks'). The exact accepted values aren't documented by spotify_cli's own help output -- omit to use the CLI's default, or run 'history top --help' against the binary if unsure."),
        limit: z.number().int().positive().optional().describe("Maximum number of results to return"),
      },
      annotations: ANNOTATIONS.readOnly("Get top history"),
    },
    async (params) => {
      const args: string[] = ["history", "top"];
      if (params.type !== undefined) args.push("--type", params.type);
      if (params.limit !== undefined) args.push("--limit", String(params.limit));
      return formatJson(await client.run(args));
    }
  );

  defineTool(
    server,
    "get_recent_history",
    {
      description:
        "Get the current Spotify user's recently played items. Read-only. Note: due to a spotify_cli formatting quirk, each item's \"name\" field embeds a full descriptive text blob (composer/lyricist/producer/release date/descriptors) prefixed by the item's URI -- this is passed through unmodified rather than re-parsed.",
      inputSchema: {
        limit: z.number().int().positive().optional().describe("Maximum number of results to return"),
      },
      annotations: ANNOTATIONS.readOnly("Get recent history"),
    },
    async (params) => {
      const args: string[] = ["history", "recent"];
      if (params.limit !== undefined) args.push("--limit", String(params.limit));

      // 'history recent --format json' (--format json is appended by
      // client.run) returns items whose "name" field embeds a full
      // descriptive text blob -- composer/lyricist/producer/release
      // date/descriptors -- prefixed by the item's URI, rather than a
      // plain track/episode title. This is a known spotify_cli quirk, not
      // a bug in this wrapper: pass it through as-is, don't try to "fix"
      // or re-parse it.
      return formatJson(await client.run(args));
    }
  );
}
