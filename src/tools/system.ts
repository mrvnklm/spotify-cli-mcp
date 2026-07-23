import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyCliClient } from "../cli/client.js";
import { formatJson } from "../utils/formatters.js";
import { spotifyUriSchema } from "../utils/validators.js";
import { ANNOTATIONS, defineTool } from "./register.js";

export function registerSystemTools(server: McpServer, client: SpotifyCliClient): void {
  defineTool(
    server,
    "get_current_user",
    {
      description:
        "Show the current Spotify user's profile (as reported by the logged-in desktop app). Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("Get current user"),
    },
    async () => formatJson(await client.run(["me"]))
  );

  defineTool(
    server,
    "get_connection_status",
    {
      description:
        "Check whether the Spotify desktop app is running and whether it is logged in ({running, logged_in}). Read-only -- useful first call for diagnosing 'Spotify not open' or auth-related errors from other tools.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("Get connection status"),
    },
    async () => formatJson(await client.run(["status"]))
  );

  defineTool(
    server,
    "open_spotify_app",
    {
      description:
        "Launch or focus the Spotify desktop app, optionally to a specific URI. Does not change any playlist/library data -- just brings the app to the foreground (and, if a URI is given, opens that content).",
      inputSchema: {
        uri: spotifyUriSchema.optional().describe("Spotify URI to open the app to (omit to just launch/focus the app)"),
      },
      annotations: ANNOTATIONS.additive("Open Spotify app", true),
    },
    async (params) => {
      const args: string[] = ["open"];
      if (params.uri !== undefined) args.push(params.uri);
      return formatJson(await client.run(args));
    }
  );

  defineTool(
    server,
    "navigate_to_uri",
    {
      description:
        "Launch or focus the Spotify desktop app and navigate its UI to a specific URI, optionally starting playback. Does not change any playlist/library data -- just moves the app's visible screen (and, with play, starts playback of that content).",
      inputSchema: {
        uri: spotifyUriSchema.describe("Spotify URI to navigate to"),
        play: z.boolean().optional().describe("Start playback of the URI after navigating to it"),
      },
      annotations: ANNOTATIONS.additive("Navigate to URI", true),
    },
    async (params) => {
      const args = ["navigate", params.uri];
      if (params.play) args.push("--play");
      return formatJson(await client.run(args));
    }
  );

  defineTool(
    server,
    "get_cli_version",
    {
      description:
        "Print the spotify_cli binary's version and the compile-time versions of its bundled native helpers. Read-only.",
      inputSchema: {},
      annotations: ANNOTATIONS.readOnly("Get CLI version"),
    },
    async () => formatJson(await client.run(["version"]))
  );
}
