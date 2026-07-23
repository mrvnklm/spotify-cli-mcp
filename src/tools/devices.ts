import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";
import { volumeLevelSchema } from "../utils/validators.js";
import { ANNOTATIONS, defineTool } from "./register.js";

/**
 * Shared shape for a device name/id argument -- 'devices info', 'devices
 * transfer', and 'devices volume' all accept either the device's display
 * name or its id, both of which come from 'list_devices' output.
 */
const deviceSchema = z
  .string()
  .describe("Device name or id, as shown in the 'list_devices' output (e.g. 'Kitchen Speaker' or a device id)");

export function registerDevicesTools(server: McpServer, client: SpotifyCliClient): void {
  defineTool(
    server,
    "list_devices",
    {
      description:
        "List all devices currently visible to Spotify Connect (this Mac, phones, speakers, etc.), including which one is active. Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("List devices"),
    },
    async () => formatJson(await client.run(["devices"]))
  );

  defineTool(
    server,
    "get_device_info",
    {
      description:
        "Show detailed info for a single device (name, id, type, volume, active state). Read-only.",
      inputSchema: {
        device: deviceSchema,
      },
      annotations: ANNOTATIONS.readOnly("Get device info"),
    },
    async (params) => formatJson(await client.run(["devices", "info", params.device]))
  );

  defineTool(
    server,
    "transfer_playback",
    {
      description:
        "Transfer active playback to the named device. This immediately changes what device Spotify is actually playing on in the real world; the previous device stops. Transfer back to undo.",
      inputSchema: {
        device: deviceSchema,
      },
      annotations: ANNOTATIONS.additive("Transfer playback", true),
    },
    async (params) => formatMutationResult(await client.run(["devices", "transfer", params.device]))
  );

  defineTool(
    server,
    "set_device_volume",
    {
      description:
        "Set the volume on a device. Changes real playback volume immediately (on the active device if none is specified); there is no automatic revert, so pass the previous level to undo.",
      inputSchema: {
        level: volumeLevelSchema,
        device: deviceSchema.optional().describe(
          "Device name or id, as shown in the 'list_devices' output. Defaults to the active device if omitted."
        ),
      },
      annotations: ANNOTATIONS.additive("Set device volume", true),
    },
    async (params) => {
      const args = ["devices", "volume", String(params.level)];
      if (params.device !== undefined) args.push(params.device);
      return formatMutationResult(await client.run(args));
    }
  );
}
