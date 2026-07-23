import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";
import { formatJson } from "../utils/formatters.js";
import { spotifyUriSchema } from "../utils/validators.js";

export function registerSystemTools(server: McpServer, client: SpotifyCliClient): void {
  server.tool(
    "get_current_user",
    "Show the current Spotify user's profile (as reported by the logged-in desktop app). Read-only.",
    {},
    async () => {
      try {
        const data = await client.run(["me"]);
        return { content: [{ type: "text" as const, text: formatJson(data) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "get_connection_status",
    "Check whether the Spotify desktop app is running and whether it is logged in ({running, logged_in}). Read-only -- useful first call for diagnosing 'Spotify not open' or auth-related errors from other tools.",
    {},
    async () => {
      try {
        const data = await client.run(["status"]);
        return { content: [{ type: "text" as const, text: formatJson(data) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "open_spotify_app",
    "Launch or focus the Spotify desktop app, optionally to a specific URI. Does not change any playlist/library data -- just brings the app to the foreground (and, if a URI is given, opens that content).",
    {
      uri: spotifyUriSchema.optional().describe("Spotify URI to open the app to (omit to just launch/focus the app)"),
    },
    async (params) => {
      try {
        const args: string[] = ["open"];
        if (params.uri !== undefined) args.push(params.uri);
        const data = await client.run(args);
        return { content: [{ type: "text" as const, text: formatJson(data) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "navigate_to_uri",
    "Launch or focus the Spotify desktop app and navigate its UI to a specific URI, optionally starting playback. Does not change any playlist/library data -- just moves the app's visible screen (and, with play, starts playback of that content).",
    {
      uri: spotifyUriSchema.describe("Spotify URI to navigate to"),
      play: z.boolean().optional().describe("Start playback of the URI after navigating to it"),
    },
    async (params) => {
      try {
        const args = ["navigate", params.uri];
        if (params.play) args.push("--play");
        const data = await client.run(args);
        return { content: [{ type: "text" as const, text: formatJson(data) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );

  server.tool(
    "get_cli_version",
    "Print the spotify_cli binary's version and the compile-time versions of its bundled native helpers. Read-only.",
    {},
    async () => {
      try {
        const data = await client.run(["version"]);
        return { content: [{ type: "text" as const, text: formatJson(data) }] };
      } catch (error) {
        if (error instanceof SpotifyCliError) {
          return { content: [{ type: "text" as const, text: error.toText() }], isError: true };
        }
        throw error;
      }
    }
  );
}
