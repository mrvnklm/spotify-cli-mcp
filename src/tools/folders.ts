import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";
import { spotifyUriSchema } from "../utils/validators.js";

/**
 * 'folder move --to' accepts either a destination folder URI or the literal
 * string "root" (move to the top level) -- not itself a Spotify URI.
 */
const moveDestinationSchema = z
  .union([spotifyUriSchema, z.literal("root")])
  .describe("Destination folder URI, or the literal string 'root' to move to the top level");

export function registerFoldersTools(server: McpServer, client: SpotifyCliClient): void {
  server.tool(
    "list_folders",
    "List playlist folders and playlists (the folder hierarchy). Read-only -- does not modify any data. Use recursive to expose the full hierarchy with parent_uri and depth for every descendant.",
    {
      folder: spotifyUriSchema.optional().describe("List only the direct contents of this folder URI (omit to list from the top level)"),
      recursive: z.boolean().optional().describe("Return all descendants as a depth-first hierarchy instead of just the direct contents"),
    },
    async (params) => {
      try {
        // Unlike 'devices'/'queue'/'jam', bare 'folder' with no subcommand
        // does NOT default to 'list' -- it falls back to printing top-level
        // help with a non-zero exit (confirmed live). Pass 'list' explicitly.
        const args: string[] = ["folder", "list"];
        if (params.folder !== undefined) args.push("--folder", params.folder);
        if (params.recursive) args.push("--recursive");

        const result = await client.run(args);
        return { content: [{ type: "text" as const, text: formatJson(result) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "create_folder",
    "Create a new playlist folder, optionally nested inside an existing parent folder. Additive -- does not modify or delete any existing playlists or folders.",
    {
      name: z.string().min(1).describe("Name for the new folder"),
      in: spotifyUriSchema.optional().describe("Parent folder URI to create the new folder inside (omit to create at the top level)"),
    },
    async (params) => {
      try {
        const args: string[] = ["folder", "create", params.name];
        if (params.in !== undefined) args.push("--in", params.in);

        const result = await client.run(args);
        return { content: [{ type: "text" as const, text: formatMutationResult(result) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "rename_folder",
    "Rename an existing playlist folder. This overwrites the folder's current name in place -- the old name is not recoverable via this API afterward unless it was captured beforehand (e.g. by calling list_folders first).",
    {
      folder_uri: spotifyUriSchema.describe("URI of the folder to rename"),
      new_name: z.string().min(1).describe("New name for the folder"),
    },
    async (params) => {
      try {
        const args = ["folder", "rename", params.folder_uri, params.new_name];

        const result = await client.run(args);
        return { content: [{ type: "text" as const, text: formatMutationResult(result) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "move_to_folder",
    "Move one or more playlists or folders into a destination folder, or to the top level via 'root'. This reorganizes where items live in the folder hierarchy -- it does not delete or otherwise modify the playlists/folders being moved.",
    {
      uris: z.array(spotifyUriSchema).min(1).describe("One or more playlist or folder URIs to move"),
      to: moveDestinationSchema,
    },
    async (params) => {
      try {
        const args = ["folder", "move", ...params.uris, "--to", params.to];

        const result = await client.run(args);
        return { content: [{ type: "text" as const, text: formatMutationResult(result) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "remove_folder",
    "Remove a playlist folder. THIS CAN PERMANENTLY DELETE DATA: setting keep_contents to false deletes every playlist nested inside this folder, with no undo available via this API. By default this tool passes keep_contents=true, which is a SAFE-DEFAULT OVERRIDE of the underlying spotify_cli command's own behavior (spotify_cli itself deletes the folder's contents unless --keep-contents is explicitly passed) -- so calling this tool with no arguments beyond folder_uri moves the folder's nested playlists up to the parent folder and only removes the now-empty folder, rather than deleting them.",
    {
      folder_uri: spotifyUriSchema.describe("URI of the folder to remove"),
      keep_contents: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "If true (the default), move the folder's contents to the parent folder before removing the now-empty folder. If false, PERMANENTLY DELETE every playlist nested inside this folder along with the folder itself -- this cannot be undone via this API."
        ),
    },
    async (params) => {
      try {
        const args = ["folder", "remove", params.folder_uri];
        if (params.keep_contents) args.push("--keep-contents");

        const result = await client.run(args);
        return { content: [{ type: "text" as const, text: formatMutationResult(result) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );
}
