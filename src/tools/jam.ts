import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";
import { ANNOTATIONS, defineTool } from "./register.js";

export function registerJamTools(server: McpServer, client: SpotifyCliClient): void {
  defineTool(
    server,
    "get_jam_status",
    {
      description:
        "Show the current Jam (shared listening session) status, including whether a Jam is active, host/session info, and the join_token used to invite others. Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("Get Jam status"),
    },
    async () => formatJson(await client.run(["jam"]))
  );

  defineTool(
    server,
    "list_jam_members",
    {
      description: "List the members currently in the active Jam session. Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("List Jam members"),
    },
    async () => formatJson(await client.run(["jam", "members"]))
  );

  defineTool(
    server,
    "create_jam",
    {
      description:
        "Start a new Jam (shared listening session) on the current device, so other real people can join and listen along.",
      inputSchema: {},
      annotations: ANNOTATIONS.additive("Create Jam"),
    },
    async () => formatMutationResult(await client.run(["jam", "create"]))
  );

  defineTool(
    server,
    "leave_jam",
    {
      description:
        "Leave the current Jam session. This removes this device from the shared listening session; there is no undo, though you (or the host) can start/rejoin a new one.",
      inputSchema: {},
      // Only affects this device's participation, and is recoverable by
      // rejoining -- unlike end_jam/kick_from_jam, which affect other people.
      annotations: ANNOTATIONS.additive("Leave Jam", true),
    },
    async () => formatMutationResult(await client.run(["jam", "leave"]))
  );

  defineTool(
    server,
    "end_jam",
    {
      description:
        "End the current Jam session entirely (host only). This immediately ends the shared listening session for every member currently in it, not just this device -- there is no undo.",
      inputSchema: {},
      annotations: ANNOTATIONS.destructive("End Jam"),
    },
    async () => formatMutationResult(await client.run(["jam", "end"]))
  );

  defineTool(
    server,
    "kick_from_jam",
    {
      description:
        "Remove a real person from the current Jam session by username (host only). This immediately kicks that participant out of the shared listening session -- there is no undo, and the affected person will be notified they were removed.",
      inputSchema: {
        username: z.string().describe("Username of the Jam participant to kick out"),
      },
      annotations: ANNOTATIONS.destructive("Kick from Jam"),
    },
    async (params) => formatMutationResult(await client.run(["jam", "kick", params.username]))
  );

  defineTool(
    server,
    "set_jam_permissions",
    {
      description:
        "View or change permissions for the current Jam session (host only for changes): queue_only restricts participants to only adding songs to the queue, volume_control allows/disallows participants from controlling playback volume. Call with neither parameter to just view the current permissions without changing anything.",
      inputSchema: {
        queue_only: z
          .enum(["on", "off"])
          .optional()
          .describe("Set queue-only mode: 'on' restricts participants to only adding to the queue, 'off' allows full control. Omit to leave unchanged."),
        volume_control: z
          .enum(["on", "off"])
          .optional()
          .describe("Allow ('on') or disallow ('off') participants from controlling playback volume. Omit to leave unchanged."),
      },
      annotations: ANNOTATIONS.additive("Set Jam permissions", true),
    },
    async (params) => {
      const args = ["jam", "permissions"];
      if (params.queue_only !== undefined) args.push("--queue-only", params.queue_only);
      if (params.volume_control !== undefined) args.push("--volume-control", params.volume_control);
      return formatMutationResult(await client.run(args));
    }
  );
}
