import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";
import { spotifyUriSchema } from "../utils/validators.js";
import { formatJson } from "../utils/formatters.js";

export function registerQueueTools(server: McpServer, client: SpotifyCliClient): void {
  server.tool(
    "get_queue",
    "View the current playback queue (the upcoming tracks). Read-only.",
    {},
    async () => {
      try {
        const data = await client.run(["queue"]);
        return {
          content: [{ type: "text" as const, text: formatJson(data) }],
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
    "add_to_queue",
    "Add a track to the end of the playback queue.",
    {
      uri: spotifyUriSchema,
    },
    async (params) => {
      try {
        const data = await client.run(["queue", "add", params.uri]);
        return {
          content: [{ type: "text" as const, text: formatJson(data) }],
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
    "remove_from_queue",
    "Remove a track at the given 0-based position from the upcoming queue. This permanently drops that track from the queue -- there is no built-in undo, though it can be re-added with add_to_queue.",
    {
      position: z.number().int().min(0).describe("0-based position of the track to remove from the upcoming queue"),
    },
    async (params) => {
      try {
        const data = await client.run(["queue", "remove", String(params.position)]);
        return {
          content: [{ type: "text" as const, text: formatJson(data) }],
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
    "move_in_queue",
    "Move a track from one 0-based position to another in the queue, reordering the upcoming queue in place.",
    {
      from: z.number().int().min(0).describe("0-based position of the track to move"),
      to: z.number().int().min(0).describe("0-based destination position for the track"),
    },
    async (params) => {
      try {
        const data = await client.run(["queue", "move", String(params.from), String(params.to)]);
        return {
          content: [{ type: "text" as const, text: formatJson(data) }],
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
