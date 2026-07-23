import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";
import { formatJson } from "../utils/formatters.js";
import { volumeLevelSchema } from "../utils/validators.js";

/**
 * Shared shape for a device name/id argument -- 'devices info', 'devices
 * transfer', and 'devices volume' all accept either the device's display
 * name or its id, both of which come from 'list_devices' output.
 */
const deviceSchema = z
  .string()
  .describe("Device name or id, as shown in the 'list_devices' output (e.g. 'Kitchen Speaker' or a device id)");

export function registerDevicesTools(server: McpServer, client: SpotifyCliClient): void {
  server.tool(
    "list_devices",
    "List all devices currently visible to Spotify Connect (this Mac, phones, speakers, etc.), including which one is active. Read-only.",
    {},
    async () => {
      try {
        const data = await client.run(["devices"]);
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
    "get_device_info",
    "Show detailed info for a single device (name, id, type, volume, active state). Read-only.",
    {
      device: deviceSchema,
    },
    async (params) => {
      try {
        const data = await client.run(["devices", "info", params.device]);
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
    "transfer_playback",
    "Transfer active playback to the named device. This immediately changes what device Spotify is actually playing on in the real world; the previous device stops. Transfer back to undo.",
    {
      device: deviceSchema,
    },
    async (params) => {
      try {
        const data = await client.run(["devices", "transfer", params.device]);
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
    "set_device_volume",
    "Set the volume on a device. Changes real playback volume immediately (on the active device if none is specified); there is no automatic revert, so pass the previous level to undo.",
    {
      level: volumeLevelSchema,
      device: deviceSchema.optional().describe(
        "Device name or id, as shown in the 'list_devices' output. Defaults to the active device if omitted."
      ),
    },
    async (params) => {
      try {
        const args = ["devices", "volume", String(params.level)];
        if (params.device !== undefined) args.push(params.device);
        const data = await client.run(args);
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
