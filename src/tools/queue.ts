import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { spotifyUriSchema } from "../utils/validators.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";
import { ANNOTATIONS, defineTool } from "./register.js";

export function registerQueueTools(server: McpServer, client: SpotifyCliClient): void {
  defineTool(
    server,
    "get_queue",
    {
      description: "View the current playback queue (the upcoming tracks). Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("Get queue"),
    },
    async () => formatJson(await client.run(["queue"]))
  );

  defineTool(
    server,
    "add_to_queue",
    {
      description: "Add a track to the end of the playback queue.",
      inputSchema: {
        uri: spotifyUriSchema,
      },
      // Not idempotent: calling twice queues the same track twice.
      annotations: ANNOTATIONS.additive("Add to queue"),
    },
    async (params) => formatMutationResult(await client.run(["queue", "add", params.uri]))
  );

  defineTool(
    server,
    "remove_from_queue",
    {
      description:
        "Remove a track at the given 0-based position from the upcoming queue. This permanently drops that track from the queue -- there is no built-in undo, though it can be re-added with add_to_queue.",
      inputSchema: {
        position: z.number().int().min(0).describe("0-based position of the track to remove from the upcoming queue"),
      },
      annotations: ANNOTATIONS.destructive("Remove from queue"),
    },
    async (params) => formatMutationResult(await client.run(["queue", "remove", String(params.position)]))
  );

  defineTool(
    server,
    "move_in_queue",
    {
      description:
        "Move a track from one 0-based position to another in the queue, reordering the upcoming queue in place.",
      inputSchema: {
        from: z.number().int().min(0).describe("0-based position of the track to move"),
        to: z.number().int().min(0).describe("0-based destination position for the track"),
      },
      // Reorders rather than removes, but repeating the call keeps shifting
      // positions, so it is not idempotent.
      annotations: ANNOTATIONS.additive("Move in queue"),
    },
    async (params) =>
      formatMutationResult(await client.run(["queue", "move", String(params.from), String(params.to)]))
  );
}
