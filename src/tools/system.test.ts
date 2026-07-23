import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSystemTools } from "./system.js";
import type { SpotifyCliClient } from "../cli/client.js";
import { SpotifyCliError } from "../cli/errors.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/**
 * Minimal fake McpServer that just captures each registered tool's handler
 * (the last argument passed to `server.tool(...)`) so it can be invoked
 * directly in tests without spinning up a real MCP transport.
 */
function createFakeServer(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1] as ToolHandler;
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

function createFakeClient(response: unknown): { client: SpotifyCliClient; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockResolvedValue(response);
  const client = { run } as unknown as SpotifyCliClient;
  return { client, run };
}

function registerAndGetHandlers(client: SpotifyCliClient): Map<string, ToolHandler> {
  const { server, handlers } = createFakeServer();
  registerSystemTools(server, client);
  return handlers;
}

function getHandler(handlers: Map<string, ToolHandler>, name: string): ToolHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} tool was not registered`);
  return handler;
}

describe("get_current_user", () => {
  it("calls 'me' with no arguments and formats the result", async () => {
    const { client, run } = createFakeClient({ id: "u1", display_name: "Marvin" });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_current_user");

    const result = await handler({});

    expect(run).toHaveBeenCalledWith(["me"]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Marvin");
  });

  it("maps a SpotifyCliError to isError content via toText()", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new SpotifyCliError(1, "not logged in", "", undefined, ["me"]));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_current_user");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not logged in");
  });

  it("propagates non-SpotifyCliError errors instead of swallowing them", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new Error("boom"));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_current_user");

    await expect(handler({})).rejects.toThrow("boom");
  });
});

describe("get_connection_status", () => {
  it("calls 'status' with no arguments and formats the result", async () => {
    const { client, run } = createFakeClient({ running: true, logged_in: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_connection_status");

    const result = await handler({});

    expect(run).toHaveBeenCalledWith(["status"]);
    expect(result.content[0].text).toContain("logged_in");
  });

  it("maps a SpotifyCliError to isError content via toText()", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new SpotifyCliError(1, "spotify not running", "", undefined, ["status"]));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_connection_status");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("spotify not running");
  });
});

describe("open_spotify_app", () => {
  it("calls 'open' with no arguments when no uri is given", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "open_spotify_app");

    await handler({});

    expect(run).toHaveBeenCalledWith(["open"]);
  });

  it("passes the uri positionally after 'open' when given", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "open_spotify_app");

    await handler({ uri: "spotify:track:abc" });

    expect(run).toHaveBeenCalledWith(["open", "spotify:track:abc"]);
  });

  it("maps a SpotifyCliError to isError content via toText()", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new SpotifyCliError(1, "launch failed", "", undefined, ["open"]));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "open_spotify_app");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("launch failed");
  });
});

describe("navigate_to_uri", () => {
  it("passes the uri positionally after 'navigate' without --play by default", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "navigate_to_uri");

    await handler({ uri: "spotify:track:abc123" });

    expect(run).toHaveBeenCalledWith(["navigate", "spotify:track:abc123"]);
  });

  it("appends --play when play is true", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "navigate_to_uri");

    await handler({ uri: "spotify:episode:abc123", play: true });

    expect(run).toHaveBeenCalledWith(["navigate", "spotify:episode:abc123", "--play"]);
  });

  it("omits --play when play is explicitly false", async () => {
    const { client, run } = createFakeClient({ success: true });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "navigate_to_uri");

    await handler({ uri: "spotify:album:xyz", play: false });

    expect(run).toHaveBeenCalledWith(["navigate", "spotify:album:xyz"]);
  });

  it("maps a SpotifyCliError to isError content via toText()", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new SpotifyCliError(1, "invalid uri", "", undefined, ["navigate"]));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "navigate_to_uri");

    const result = await handler({ uri: "spotify:track:abc123" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("invalid uri");
  });
});

describe("get_cli_version", () => {
  it("calls 'version' with no arguments and formats the result", async () => {
    const { client, run } = createFakeClient({ cli_version: "1.2.3" });
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_cli_version");

    const result = await handler({});

    expect(run).toHaveBeenCalledWith(["version"]);
    expect(result.content[0].text).toContain("1.2.3");
  });

  it("maps a SpotifyCliError to isError content via toText()", async () => {
    const { client, run } = createFakeClient(undefined);
    run.mockRejectedValue(new SpotifyCliError(1, "version check failed", "", undefined, ["version"]));
    const handlers = registerAndGetHandlers(client);
    const handler = getHandler(handlers, "get_cli_version");

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("version check failed");
  });
});
