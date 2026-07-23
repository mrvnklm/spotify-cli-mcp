#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./utils/config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  // Unlike the reference project, loadConfig() never throws here -- there
  // are no required env vars (SPOTIFY_CLI_PATH is optional with a default),
  // so there is no "missing config" exit path to handle.
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
