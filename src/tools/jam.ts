import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";

export function registerJamTools(server: McpServer, client: SpotifyCliClient): void {
  server.tool(
    "get_jam_status",
    "Show the current Jam (shared listening session) status, including whether a Jam is active, host/session info, and the join_token used to invite others. Read-only.",
    {},
    async () => {
      try {
        const data = await client.run(["jam"]);
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
    "list_jam_members",
    "List the members currently in the active Jam session. Read-only.",
    {},
    async () => {
      try {
        const data = await client.run(["jam", "members"]);
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
    "create_jam",
    "Start a new Jam (shared listening session) on the current device, so other real people can join and listen along.",
    {},
    async () => {
      try {
        const data = await client.run(["jam", "create"]);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(data) }],
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
    "leave_jam",
    "Leave the current Jam session. This removes this device from the shared listening session; there is no undo, though you (or the host) can start/rejoin a new one.",
    {},
    async () => {
      try {
        const data = await client.run(["jam", "leave"]);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(data) }],
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
    "end_jam",
    "End the current Jam session entirely (host only). This immediately ends the shared listening session for every member currently in it, not just this device -- there is no undo.",
    {},
    async () => {
      try {
        const data = await client.run(["jam", "end"]);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(data) }],
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
    "kick_from_jam",
    "Remove a real person from the current Jam session by username (host only). This immediately kicks that participant out of the shared listening session -- there is no undo, and the affected person will be notified they were removed.",
    {
      username: z.string().describe("Username of the Jam participant to kick out"),
    },
    async (params) => {
      try {
        const data = await client.run(["jam", "kick", params.username]);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(data) }],
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
    "set_jam_permissions",
    "View or change permissions for the current Jam session (host only for changes): queue_only restricts participants to only adding songs to the queue, volume_control allows/disallows participants from controlling playback volume. Call with neither parameter to just view the current permissions without changing anything.",
    {
      queue_only: z
        .enum(["on", "off"])
        .optional()
        .describe("Set queue-only mode: 'on' restricts participants to only adding to the queue, 'off' allows full control. Omit to leave unchanged."),
      volume_control: z
        .enum(["on", "off"])
        .optional()
        .describe("Allow ('on') or disallow ('off') participants from controlling playback volume. Omit to leave unchanged."),
    },
    async (params) => {
      try {
        const args = ["jam", "permissions"];
        if (params.queue_only !== undefined) args.push("--queue-only", params.queue_only);
        if (params.volume_control !== undefined) args.push("--volume-control", params.volume_control);

        const data = await client.run(args);
        return {
          content: [{ type: "text" as const, text: formatMutationResult(data) }],
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
