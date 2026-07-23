import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";
import { spotifyUriSchema, volumeLevelSchema, playbackSpeedSchema } from "../utils/validators.js";
import { ANNOTATIONS, defineTool, ToolInputError } from "./register.js";

export function registerPlaybackTools(server: McpServer, client: SpotifyCliClient): void {
  defineTool(
    server,
    "play",
    {
      description:
        "Play a Spotify URI, or resume playback if called with no URI. This immediately changes what is audibly playing on the target device (the active device, or the one named via 'device') right now.",
      inputSchema: {
        uri: spotifyUriSchema.optional().describe("Spotify URI to play (track, album, playlist, artist, etc.). Omit to resume the current playback instead."),
        device: z.string().optional().describe("Device name or id, as shown in the 'list_devices' output. Playback is transferred to this device before starting. Omit to use the active device."),
      },
      annotations: ANNOTATIONS.additive("Play", true),
    },
    async (params) => {
      const args = ["play"];
      if (params.uri !== undefined) args.push(params.uri);
      if (params.device !== undefined) args.push("--device", params.device);
      return formatMutationResult(await client.run(args));
    }
  );

  defineTool(
    server,
    "pause",
    {
      description:
        "Pause playback on the active device. This immediately stops audio playing in the real world; resume with the 'resume' tool.",
      inputSchema: {},
      annotations: ANNOTATIONS.additive("Pause", true),
    },
    async () => formatMutationResult(await client.run(["pause"]))
  );

  defineTool(
    server,
    "resume",
    {
      description: "Resume playback on the active device from wherever it was paused.",
      inputSchema: {},
      annotations: ANNOTATIONS.additive("Resume", true),
    },
    async () => formatMutationResult(await client.run(["resume"]))
  );

  defineTool(
    server,
    "skip_to_next",
    {
      description:
        "Skip to the next track in the current playback context. This immediately changes what is playing; the skipped track is not recoverable as \"next\" again without navigating back via skip_to_previous (which may not return to the exact same track depending on the context).",
      inputSchema: {},
      annotations: ANNOTATIONS.additive("Skip to next"),
    },
    async () => formatMutationResult(await client.run(["next"]))
  );

  defineTool(
    server,
    "skip_to_previous",
    {
      description:
        "Skip to the previous track in the current playback context. This immediately changes what is playing.",
      inputSchema: {},
      annotations: ANNOTATIONS.additive("Skip to previous"),
    },
    async () => formatMutationResult(await client.run(["previous"]))
  );

  defineTool(
    server,
    "seek",
    {
      description:
        "Seek to a position in the currently playing track, either an absolute position or relative to the current position. This immediately jumps playback to the new position in the real world.",
      inputSchema: {
        ms: z.number().int().describe("Position in milliseconds. Absolute position by default (must be >= 0); with relative=true, a positive value seeks forward and a negative value seeks backward from the current position."),
        relative: z.boolean().optional().describe("Seek relative to the current position instead of to an absolute position. Required if ms is negative."),
      },
      annotations: ANNOTATIONS.additive("Seek"),
    },
    async (params) => {
      if (params.ms < 0 && !params.relative) {
        throw new ToolInputError(
          "a negative ms value is only valid with relative=true (it seeks backward from the current position). For an absolute seek, ms must be >= 0."
        );
      }
      const args = ["seek", String(params.ms)];
      if (params.relative) args.push("--relative");
      return formatMutationResult(await client.run(args));
    }
  );

  defineTool(
    server,
    "set_shuffle",
    {
      description: "Turn shuffle mode on or off for the active playback.",
      inputSchema: {
        mode: z.enum(["on", "off"]).describe("Desired shuffle state"),
      },
      annotations: ANNOTATIONS.additive("Set shuffle", true),
    },
    async (params) => formatMutationResult(await client.run(["shuffle", params.mode]))
  );

  defineTool(
    server,
    "set_repeat",
    {
      description:
        "Set the repeat mode for the active playback: 'off' (no repeat), 'context' (repeat the current album/playlist), or 'track' (repeat the current track). Omit mode to cycle to the next mode instead of setting one explicitly.",
      inputSchema: {
        mode: z.enum(["off", "context", "track"]).optional().describe("Repeat mode to set. Omit to cycle through modes (off -> context -> track -> off)."),
      },
      // Deliberately not marked idempotent: omitting `mode` cycles to the
      // next mode, so repeating the same call keeps changing the result.
      annotations: ANNOTATIONS.additive("Set repeat"),
    },
    async (params) => {
      const args = ["repeat"];
      if (params.mode !== undefined) args.push(params.mode);
      return formatMutationResult(await client.run(args));
    }
  );

  defineTool(
    server,
    "set_playback_speed",
    {
      description:
        "Set the playback speed of the currently playing content (e.g. slow down or speed up a podcast/track). Changes audible playback speed immediately.",
      inputSchema: {
        rate: playbackSpeedSchema,
      },
      annotations: ANNOTATIONS.additive("Set playback speed", true),
    },
    async (params) => formatMutationResult(await client.run(["speed", String(params.rate)]))
  );

  defineTool(
    server,
    "set_volume",
    {
      description:
        "Set the playback volume for the active device. Changes real playback volume immediately; there is no automatic revert, so pass the previous level to undo.",
      inputSchema: {
        level: volumeLevelSchema,
      },
      annotations: ANNOTATIONS.additive("Set volume", true),
    },
    async (params) => formatMutationResult(await client.run(["volume", String(params.level)]))
  );

  defineTool(
    server,
    "get_now_playing",
    {
      description: "Show the currently playing track. Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("Get now playing"),
    },
    async () => formatJson(await client.run(["now-playing"]))
  );
}
