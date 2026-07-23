import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SpotifyCliClient } from "./cli/client.js";
import type { SpotifyCliConfig } from "./utils/config.js";
import { registerPlaybackTools } from "./tools/playback.js";
import { registerDevicesTools } from "./tools/devices.js";
import { registerQueueTools } from "./tools/queue.js";
import { registerJamTools } from "./tools/jam.js";
import { registerContentTools } from "./tools/content.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerPlaylistsTools } from "./tools/playlists.js";
import { registerFoldersTools } from "./tools/folders.js";
import { registerSystemTools } from "./tools/system.js";

// package.json sits one directory above dist/ (repo root and npm package
// root share this layout) -- read it directly instead of hardcoding a
// version that drifts out of sync. Falls back to a placeholder rather than
// throwing: this is a cosmetic value reported to MCP clients and must never
// prevent the server from starting.
function readPackageVersion(): string {
  try {
    const packageDir = dirname(fileURLToPath(import.meta.url));
    const pkg: unknown = JSON.parse(readFileSync(join(packageDir, "..", "package.json"), "utf8"));
    const version = (pkg as { version?: unknown }).version;
    return typeof version === "string" ? version : "0.0.0-unknown";
  } catch {
    return "0.0.0-unknown";
  }
}

export function createServer(config: SpotifyCliConfig): McpServer {
  const server = new McpServer({
    name: "spotify-cli",
    version: readPackageVersion(),
  });

  const client = new SpotifyCliClient(config);

  registerPlaybackTools(server, client);
  registerDevicesTools(server, client);
  registerQueueTools(server, client);
  registerJamTools(server, client);
  registerContentTools(server, client);
  registerLibraryTools(server, client);
  registerPlaylistsTools(server, client);
  registerFoldersTools(server, client);
  registerSystemTools(server, client);

  return server;
}
