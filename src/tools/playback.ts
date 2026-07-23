import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";
import { formatJson, formatMutationResult } from "../utils/formatters.js";
import { spotifyUriSchema, volumeLevelSchema, playbackSpeedSchema } from "../utils/validators.js";

export function registerPlaybackTools(server: McpServer, client: SpotifyCliClient): void {
  server.tool(
    "play",
    "Play a Spotify URI, or resume playback if called with no URI. This immediately changes what is audibly playing on the target device (the active device, or the one named via 'device') right now.",
    {
      uri: spotifyUriSchema.optional().describe("Spotify URI to play (track, album, playlist, artist, etc.). Omit to resume the current playback instead."),
      device: z.string().optional().describe("Device name or id, as shown in the 'list_devices' output. Playback is transferred to this device before starting. Omit to use the active device."),
    },
    async (params) => {
      try {
        const args = ["play"];
        if (params.uri !== undefined) args.push(params.uri);
        if (params.device !== undefined) args.push("--device", params.device);
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

  server.tool(
    "pause",
    "Pause playback on the active device. This immediately stops audio playing in the real world; resume with the 'resume' tool.",
    {},
    async () => {
      try {
        const data = await client.run(["pause"]);
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
    "resume",
    "Resume playback on the active device from wherever it was paused.",
    {},
    async () => {
      try {
        const data = await client.run(["resume"]);
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
    "skip_to_next",
    "Skip to the next track in the current playback context. This immediately changes what is playing; the skipped track is not recoverable as \"next\" again without navigating back via skip_to_previous (which may not return to the exact same track depending on the context).",
    {},
    async () => {
      try {
        const data = await client.run(["next"]);
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
    "skip_to_previous",
    "Skip to the previous track in the current playback context. This immediately changes what is playing.",
    {},
    async () => {
      try {
        const data = await client.run(["previous"]);
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
    "seek",
    "Seek to a position in the currently playing track, either an absolute position or relative to the current position. This immediately jumps playback to the new position in the real world.",
    {
      ms: z.number().int().describe("Position in milliseconds. Absolute position by default (must be >= 0); with relative=true, a positive value seeks forward and a negative value seeks backward from the current position."),
      relative: z.boolean().optional().describe("Seek relative to the current position instead of to an absolute position. Required if ms is negative."),
    },
    async (params) => {
      if (params.ms < 0 && !params.relative) {
        return {
          content: [{
            type: "text" as const,
            text: "Error: a negative ms value is only valid with relative=true (it seeks backward from the current position). For an absolute seek, ms must be >= 0.",
          }],
          isError: true,
        };
      }
      try {
        const args = ["seek", String(params.ms)];
        if (params.relative) args.push("--relative");
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

  server.tool(
    "set_shuffle",
    "Turn shuffle mode on or off for the active playback.",
    {
      mode: z.enum(["on", "off"]).describe("Desired shuffle state"),
    },
    async (params) => {
      try {
        const data = await client.run(["shuffle", params.mode]);
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
    "set_repeat",
    "Set the repeat mode for the active playback: 'off' (no repeat), 'context' (repeat the current album/playlist), or 'track' (repeat the current track). Omit mode to cycle to the next mode instead of setting one explicitly.",
    {
      mode: z.enum(["off", "context", "track"]).optional().describe("Repeat mode to set. Omit to cycle through modes (off -> context -> track -> off)."),
    },
    async (params) => {
      try {
        const args = ["repeat"];
        if (params.mode !== undefined) args.push(params.mode);
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

  server.tool(
    "set_playback_speed",
    "Set the playback speed of the currently playing content (e.g. slow down or speed up a podcast/track). Changes audible playback speed immediately.",
    {
      rate: playbackSpeedSchema,
    },
    async (params) => {
      try {
        const data = await client.run(["speed", String(params.rate)]);
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
    "set_volume",
    "Set the playback volume for the active device. Changes real playback volume immediately; there is no automatic revert, so pass the previous level to undo.",
    {
      level: volumeLevelSchema,
    },
    async (params) => {
      try {
        const data = await client.run(["volume", String(params.level)]);
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
    "get_now_playing",
    "Show the currently playing track. Read-only.",
    {},
    async () => {
      try {
        const data = await client.run(["now-playing"]);
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
